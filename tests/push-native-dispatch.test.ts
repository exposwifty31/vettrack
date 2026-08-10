/**
 * G4-2 — the send library must route each subscription to the correct native
 * transport: web → web-push (unchanged), ios → APNs, android|expo → FCM. The
 * public sendPush* signatures stay stable; the platform fan-out happens inside.
 *
 * Transports are mocked at the module boundary (push-apns / push-fcm / web-push)
 * so this test asserts ROUTING + payload shape without any real credentials or
 * network. It also proves the wire from the public entrypoint:
 * token → subscription row → sendPushToUser → dispatcher → sendApnsPush.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const sendApnsPush = vi.fn(async () => "ok" as const);
const sendFcmPush = vi.fn(async () => "ok" as const);
const webpushSend = vi.fn(async () => undefined);
const incrementMetric = vi.fn();

let userSubs: Array<Record<string, unknown>> = [];

vi.mock("../server/db.js", () => {
  const selectResult = {
    from: () => selectResult,
    where: () => Promise.resolve(userSubs),
  };
  return {
    db: {
      select: () => selectResult,
      transaction: async (cb: (tx: unknown) => unknown) => cb({}),
      delete: () => ({ where: () => Promise.resolve(undefined) }),
    },
    pool: {},
    pushSubscriptions: { clinicId: "clinic_col", userId: "user_col", endpoint: "endpoint_col", token: "token_col" },
    serverConfig: { key: "key_col" },
    users: {},
  };
});

vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => ({ _t: "and", a }),
  eq: (a: unknown, b: unknown) => ({ _t: "eq", a, b }),
  isNull: (x: unknown) => ({ _t: "isNull", x }),
}));

vi.mock("../server/lib/realtime-outbox.js", () => ({
  insertRealtimeDomainEvent: vi.fn(async () => undefined),
}));

vi.mock("../server/lib/metrics.js", () => ({
  incrementMetric,
}));

vi.mock("../server/lib/push-apns.js", () => ({
  sendApnsPush,
  isApnsReady: () => true,
  initApns: vi.fn(async () => undefined),
}));

vi.mock("../server/lib/push-fcm.js", () => ({
  sendFcmPush,
  isFcmReady: () => true,
  initFcm: vi.fn(async () => undefined),
}));

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    generateVAPIDKeys: vi.fn(() => ({ publicKey: "GENPUB", privateKey: "GENPRIV" })),
    sendNotification: webpushSend,
  },
}));

const ENVELOPE = { title: "Code Blue", body: "Room 3", referenceId: "session-abc" };

describe("push dispatcher — platform routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userSubs = [];
  });

  it("routes an iOS subscription to the APNs transport", async () => {
    const push = await import("../server/lib/push.js");
    const result = await push.dispatchToSubscription(
      { platform: "ios", token: "IOSTOKEN", endpoint: null, p256dh: null, auth: null },
      ENVELOPE,
    );
    expect(sendApnsPush).toHaveBeenCalledWith("IOSTOKEN", ENVELOPE);
    expect(sendFcmPush).not.toHaveBeenCalled();
    expect(webpushSend).not.toHaveBeenCalled();
    expect(result).toBe("ok");
    // Native sends must feed the same observability counters as web-push.
    expect(incrementMetric).toHaveBeenCalledWith("notifications_sent");
  });

  it("routes an Android subscription to the FCM transport", async () => {
    const push = await import("../server/lib/push.js");
    await push.dispatchToSubscription(
      { platform: "android", token: "FCMTOKEN", endpoint: null, p256dh: null, auth: null },
      ENVELOPE,
    );
    expect(sendFcmPush).toHaveBeenCalledWith("FCMTOKEN", ENVELOPE);
    expect(sendApnsPush).not.toHaveBeenCalled();
    expect(webpushSend).not.toHaveBeenCalled();
  });

  it("routes an Expo subscription to the FCM transport", async () => {
    const push = await import("../server/lib/push.js");
    await push.dispatchToSubscription(
      { platform: "expo", token: "EXPOTOKEN", endpoint: null, p256dh: null, auth: null },
      ENVELOPE,
    );
    expect(sendFcmPush).toHaveBeenCalledWith("EXPOTOKEN", ENVELOPE);
    expect(sendApnsPush).not.toHaveBeenCalled();
  });

  it("routes a web subscription to web-push and never to a native transport", async () => {
    process.env.VAPID_PUBLIC_KEY = "ENVPUB";
    process.env.VAPID_PRIVATE_KEY = "ENVPRIV";
    const push = await import("../server/lib/push.js");
    await push.initVapid();
    await push.dispatchToSubscription(
      { platform: "web", endpoint: "https://push.example/abc", p256dh: "p", auth: "a", token: null },
      ENVELOPE,
    );
    expect(webpushSend).toHaveBeenCalledTimes(1);
    expect(sendApnsPush).not.toHaveBeenCalled();
    expect(sendFcmPush).not.toHaveBeenCalled();
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
  });

  it("wires the public sendPushToUser entrypoint through to the APNs transport for an iOS row", async () => {
    userSubs = [
      {
        platform: "ios",
        token: "IOSTOKEN",
        endpoint: null,
        p256dh: null,
        auth: null,
        alertsEnabled: true,
        soundEnabled: true,
        userId: "user-1",
      },
    ];
    const push = await import("../server/lib/push.js");
    const res = await push.sendPushToUser("clinic-1", "user-1", { title: "Code Blue", body: "Room 3" });
    expect(sendApnsPush).toHaveBeenCalledTimes(1);
    expect(sendApnsPush.mock.calls[0][0]).toBe("IOSTOKEN");
    expect(res.deliveredAny).toBe(true);
  });
});
