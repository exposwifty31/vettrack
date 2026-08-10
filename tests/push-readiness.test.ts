/**
 * G4-2 — POST /api/push/test readiness is TRANSPORT-NEUTRAL (ADR-009).
 *
 * The `/test` route gate must accept ANY configured transport, not only web-push
 * VAPID: an APNs-only or FCM-only deployment can still send a test push, routed
 * per-subscription by the dispatcher. `isPushReady()` is that gate.
 *
 * VAPID readiness is module-internal (`vapidReady`, false until initVapid runs),
 * so with initVapid never called here, isVapidReady() is false and each case is
 * driven purely by the mocked APNs/FCM ready flags.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const apnsReady = vi.fn(() => false);
const fcmReady = vi.fn(() => false);

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
vi.mock("../server/lib/push-apns.js", () => ({
  sendApnsPush: vi.fn(),
  isApnsReady: apnsReady,
  initApns: vi.fn(),
}));
vi.mock("../server/lib/push-fcm.js", () => ({
  sendFcmPush: vi.fn(),
  isFcmReady: fcmReady,
  initFcm: vi.fn(),
}));
vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), generateVAPIDKeys: vi.fn(), sendNotification: vi.fn() },
}));

describe("isPushReady — transport-neutral readiness", () => {
  beforeEach(() => {
    apnsReady.mockReturnValue(false);
    fcmReady.mockReturnValue(false);
  });

  it("is true for an APNs-only deployment (VAPID + FCM absent)", async () => {
    apnsReady.mockReturnValue(true);
    const push = await import("../server/lib/push.js");
    expect(push.isPushReady()).toBe(true);
  });

  it("is true for an FCM-only deployment (VAPID + APNs absent)", async () => {
    fcmReady.mockReturnValue(true);
    const push = await import("../server/lib/push.js");
    expect(push.isPushReady()).toBe(true);
  });

  it("is false when no transport is configured", async () => {
    const push = await import("../server/lib/push.js");
    expect(push.isVapidReady()).toBe(false);
    expect(push.isPushReady()).toBe(false);
  });
});
