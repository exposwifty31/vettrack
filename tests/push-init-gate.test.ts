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
import { describe, it, expect, vi } from "vitest";

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

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** True if `promise` settled by the next macrotask tick, false if still pending. */
async function resolvesPromptly(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  void promise.then(() => {
    settled = true;
  });
  await tick();
  return settled;
}

describe("whenPushInitialized — startup gate", () => {
  it("resolves immediately when init was never begun (test-mode no-op never hangs) and blocks until marked once begun", async () => {
    const push = await import("../server/lib/push.js");

    // Never begun → must not block a request handler.
    expect(await resolvesPromptly(push.whenPushInitialized())).toBe(true);

    // Begun but not yet complete → the gate blocks (closes the listen→init window).
    push.beginPushInitialization();
    expect(await resolvesPromptly(push.whenPushInitialized())).toBe(false);

    // Init sequence attempted → the gate releases.
    push.markPushInitialized();
    expect(await resolvesPromptly(push.whenPushInitialized())).toBe(true);
  });
});
