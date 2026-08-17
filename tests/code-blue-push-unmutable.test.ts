/**
 * A user preference must not be able to suppress a Code Blue page.
 *
 * The defect this pins was live in production, and the label is what made it
 * dangerous. `src/pages/settings.tsx:146` writes `alertsEnabled` from a toggle
 * the user reads as "Critical alerts — Enable SOUND for urgent EQUIPMENT
 * alerts" (`locales/{en,he}.json:1264-1265`). Both scoping promises in that
 * sentence are false: it does not mute a sound, it suppresses DELIVERY; and it
 * is not limited to equipment, because `sendPushToAll` skips the whole
 * subscription and `sendPushToAll` is how `code_blue_broadcast` is delivered
 * (`server/workers/notification.worker.ts` ← `server/routes/code-blue.ts:506`
 * for `/sessions` and `:667` for `/one-tap`).
 *
 * So a technician silencing what looks like an equipment chime silently stopped
 * receiving cardiac-arrest pages, and nothing anywhere reported it.
 *
 * Owner decision 2026-08-16: no clinical scenario needs routine alerts muted,
 * and emergency alerting must not be mutable at all. The chosen shape is a
 * SEPARATE emergency sender rather than a flag threaded through the existing
 * one — an opt-in bypass parameter is a gate someone forgets to pass, whereas a
 * function that never reads the preference cannot consult it by accident.
 *
 * Transports and db are mocked at the module boundary, as in
 * push-native-dispatch.test.ts — this asserts the GATE, not the wire.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PushDispatchOutcome } from "../server/lib/push-types.js";

const sendApnsPush = vi.fn(async (_t: string, _p: unknown): Promise<PushDispatchOutcome> => "ok");
const sendFcmPush = vi.fn(async (_t: string, _p: unknown): Promise<PushDispatchOutcome> => "ok");
const webpushSend = vi.fn(async () => undefined);

let clinicSubs: Array<Record<string, unknown>> = [];

vi.mock("../server/db.js", () => {
  const selectResult = {
    from: () => selectResult,
    where: () => Promise.resolve(clinicSubs),
  };
  return {
    db: {
      select: () => selectResult,
      transaction: async (cb: (tx: unknown) => unknown) => cb({}),
      delete: vi.fn(() => ({ where: () => Promise.resolve(undefined) })),
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
vi.mock("../server/lib/metrics.js", () => ({ incrementMetric: vi.fn() }));
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
    generateVAPIDKeys: vi.fn(() => ({ publicKey: "PUB", privateKey: "PRIV" })),
    sendNotification: webpushSend,
  },
}));

const CODE_BLUE = { title: "⚠ CODE BLUE", body: "CODE BLUE", tag: "code-blue-1", url: "/code-blue" };

/** One iOS subscriber who has turned the mislabelled toggle OFF. */
function mutedIosSubscriber() {
  return [
    {
      clinicId: "clinic-1",
      userId: "user-1",
      endpoint: null,
      token: "apns-token-1",
      platform: "ios",
      alertsEnabled: false,
      soundEnabled: true,
    },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  clinicSubs = mutedIosSubscriber();
});

describe("a preference cannot mute a Code Blue page", () => {
  it("delivers the emergency page to a subscriber whose alerts preference is OFF", async () => {
    const { sendEmergencyPushToAll } = await import("../server/lib/push.js");

    await sendEmergencyPushToAll("clinic-1", CODE_BLUE);

    expect(sendApnsPush).toHaveBeenCalledTimes(1);
    expect(sendApnsPush.mock.calls[0][0]).toBe("apns-token-1");
  });

  it("still honours the preference for ROUTINE pushes — the split is the point", async () => {
    // If routine traffic ignored the flag too, users would mute at the OS level
    // instead, which takes Code Blue down with it (the B7 failure mode). The
    // toggle has to keep working for noise so it is never aimed at everything.
    const { sendPushToAll } = await import("../server/lib/push.js");

    await sendPushToAll("clinic-1", { title: "Charger unplugged", body: "Bay 2" });

    expect(sendApnsPush).not.toHaveBeenCalled();
  });

  it("reaches a muted subscriber even when another subscriber is unmuted", async () => {
    // Guards a fix that "works" only because some row happened to be enabled.
    clinicSubs = [
      ...mutedIosSubscriber(),
      {
        clinicId: "clinic-1",
        userId: "user-2",
        endpoint: null,
        token: "apns-token-2",
        platform: "ios",
        alertsEnabled: true,
        soundEnabled: true,
      },
    ];
    const { sendEmergencyPushToAll } = await import("../server/lib/push.js");

    await sendEmergencyPushToAll("clinic-1", CODE_BLUE);

    expect(sendApnsPush.mock.calls.map((c) => c[0]).sort()).toEqual([
      "apns-token-1",
      "apns-token-2",
    ]);
  });
});

describe("the emergency path cannot regain the preference gate", () => {
  const pushSource = () => readFileSync(resolve(process.cwd(), "server/lib/push.ts"), "utf8");

  it("sendEmergencyPushToAll never reads alertsEnabled", () => {
    // The whole reason for a separate function rather than a bypass flag: this
    // is checkable. A parameter would only be checkable at every call site.
    const src = pushSource();
    const start = src.indexOf("export async function sendEmergencyPushToAll");
    expect(start).toBeGreaterThan(-1);
    // To the function's own closing brace — NOT to the next `export`, which
    // would swallow the helpers below it whose comments discuss the preference
    // precisely because they are the ones that must not apply it.
    const end = src.indexOf("\n}\n", start);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body).not.toContain("alertsEnabled");
  });

  it("the code_blue_broadcast branch pages through the emergency sender", () => {
    // The gate is only closed if the emergency producer actually uses it; this
    // is the wire, and it is the half a future refactor would silently undo.
    const worker = readFileSync(
      resolve(process.cwd(), "server/workers/notification.worker.ts"),
      "utf8",
    );
    const branch = worker.slice(worker.indexOf('data.type === "code_blue_broadcast"'));
    const branchBody = branch.slice(0, branch.indexOf("return;"));
    expect(branchBody).toContain("sendEmergencyPushToAll");
    expect(branchBody).not.toMatch(/\bsendPushToAll\(/);
  });
});
