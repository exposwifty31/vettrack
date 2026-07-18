/**
 * Unit tests — getVapidPublicKey readiness gate (pre-resubmission finding #2).
 *
 * getVapidPublicKey() must never hand out a public key the server cannot sign
 * with. It signs only when isVapidReady() (both public + private present, per
 * initVapid). A lone VAPID_PUBLIC_KEY in the env does NOT identify the signing
 * pair — initVapid falls through to the vt_server_config DB pair — so returning
 * the env public key unconditionally hands the client a key mismatched with the
 * server's private key, silently breaking every subscription.
 *
 * db + web-push are mocked; no Redis, live server, or real database required.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let dbRows: { key: string; value: string }[] = [];

vi.mock("../server/db.js", () => {
  const makeSelect = () => {
    const q: {
      from: () => typeof q;
      where: (pred: { b?: string }) => Promise<{ key: string; value: string }[]>;
    } = {
      from: () => q,
      where: (pred: { b?: string }) => Promise.resolve(dbRows.filter((r) => r.key === pred?.b)),
    };
    return q;
  };
  const insertChain = {
    values: () => insertChain,
    onConflictDoNothing: () => Promise.resolve(undefined),
  };
  return {
    db: {
      select: () => makeSelect(),
      insert: () => insertChain,
    },
    pool: {},
    pushSubscriptions: {},
    serverConfig: { key: "key_col" },
    users: {},
  };
});

vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => ({ _t: "and", a }),
  eq: (a: unknown, b: unknown) => ({ _t: "eq", a, b }),
  isNull: (x: unknown) => ({ _t: "isNull", x }),
}));

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    generateVAPIDKeys: vi.fn(() => ({ publicKey: "GENPUB", privateKey: "GENPRIV" })),
    sendNotification: vi.fn(),
  },
}));

describe("getVapidPublicKey readiness gate", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    dbRows = [];
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it("returns null when only the public env key is set (server cannot sign)", async () => {
    process.env.VAPID_PUBLIC_KEY = "ENVPUB";
    // no private key, initVapid not run → not ready
    const push = await import("../server/lib/push.js");
    expect(push.isVapidReady()).toBe(false);
    expect(await push.getVapidPublicKey()).toBeNull();
  });

  it("returns null when VAPID is not configured at all", async () => {
    const push = await import("../server/lib/push.js");
    expect(push.isVapidReady()).toBe(false);
    expect(await push.getVapidPublicKey()).toBeNull();
  });

  it("returns the env public key when both env keys are present and ready", async () => {
    process.env.VAPID_PUBLIC_KEY = "ENVPUB";
    process.env.VAPID_PRIVATE_KEY = "ENVPRIV";
    const push = await import("../server/lib/push.js");
    await push.initVapid();
    expect(push.isVapidReady()).toBe(true);
    expect(await push.getVapidPublicKey()).toBe("ENVPUB");
  });

  it("returns the DB public key (not a stale env public key) when the signing pair is DB-sourced", async () => {
    // A lone public env key is set, but the real signing pair lives in the DB.
    process.env.VAPID_PUBLIC_KEY = "STALE_ENVPUB";
    dbRows = [
      { key: "vapid_public_key", value: "DBPUB" },
      { key: "vapid_private_key", value: "DBPRIV" },
    ];
    const push = await import("../server/lib/push.js");
    await push.initVapid();
    expect(push.isVapidReady()).toBe(true);
    expect(await push.getVapidPublicKey()).toBe("DBPUB");
  });
});
