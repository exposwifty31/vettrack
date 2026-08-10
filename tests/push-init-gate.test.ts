/**
 * G4-2 — startup push-init gate (ADR-009 / CodeRabbit PR #173 round-2 #2).
 *
 * app.listen() accepts requests before the runMigrations().then() chain has run
 * the initVapid/initApns/initFcm sequence, so a /api/push/test that lands in that
 * window would read isPushReady() === false on a legitimately-configured server.
 * whenPushInitialized() closes that window: a caller awaits it before the
 * readiness check. Safety requirement: when init was never begun (test mode,
 * where startBackgroundSchedulers is a no-op), the gate MUST resolve immediately
 * so a handler never hangs.
 *
 * Transports + db are mocked at the module boundary so this exercises only the
 * gate's own promise state — no network, no real init.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../server/db.js", () => ({
  db: {},
  pool: {},
  pushSubscriptions: {},
  serverConfig: {},
  users: {},
}));
vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => ({ _t: "and", a }),
  eq: (a: unknown, b: unknown) => ({ _t: "eq", a, b }),
  isNull: (x: unknown) => ({ _t: "isNull", x }),
}));
vi.mock("../server/lib/realtime-outbox.js", () => ({ insertRealtimeDomainEvent: vi.fn() }));
vi.mock("../server/lib/metrics.js", () => ({ incrementMetric: vi.fn() }));
vi.mock("../server/lib/push-apns.js", () => ({ sendApnsPush: vi.fn(), isApnsReady: () => false, initApns: vi.fn() }));
vi.mock("../server/lib/push-fcm.js", () => ({ sendFcmPush: vi.fn(), isFcmReady: () => false, initFcm: vi.fn() }));
vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), generateVAPIDKeys: vi.fn(), sendNotification: vi.fn() },
}));

/**
 * Flush pending microtasks so a same-tick promise resolution is observed
 * deterministically — no real timer. A resolved gate resolves on a microtask; a
 * pending gate never does, so after the flush `resolved` reliably reflects state.
 */
const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

/** True if `promise` has resolved by the next microtask flush, false if still pending. */
async function hasResolved(promise: Promise<unknown>): Promise<boolean> {
  let resolved = false;
  void promise.then(() => {
    resolved = true;
  });
  await flushMicrotasks();
  return resolved;
}

// `pushInitPromise` is module-scoped state, so each case re-imports a fresh module
// (mock registrations survive resetModules) to start from an un-armed gate — no
// leakage between cases.
describe("whenPushInitialized — startup gate", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("resolves immediately when init was never begun (test-mode no-op never hangs)", async () => {
    const push = await import("../server/lib/push.js");
    expect(await hasResolved(push.whenPushInitialized())).toBe(true);
  });

  it("blocks until marked once initialization has begun", async () => {
    const push = await import("../server/lib/push.js");
    push.beginPushInitialization();
    // Begun but not yet complete → the gate blocks (closes the listen→init window).
    expect(await hasResolved(push.whenPushInitialized())).toBe(false);
  });

  it("releases a begun gate when markPushInitialized() runs", async () => {
    const push = await import("../server/lib/push.js");
    push.beginPushInitialization();
    expect(await hasResolved(push.whenPushInitialized())).toBe(false);
    push.markPushInitialized();
    expect(await hasResolved(push.whenPushInitialized())).toBe(true);
  });
});
