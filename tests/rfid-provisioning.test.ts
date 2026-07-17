/**
 * R-M1.1c — self-serve HMAC-secret provisioning + rotation contract + ingest toggle.
 *
 * Replaces the manual `scripts/rfid/provision-secret.ts` + hand-flip of
 * `rfid.ingest_enabled.<clinicId>` with an admin-only, auth-scoped server flow.
 *
 * FROZEN R-M1 guardrails asserted here:
 *   (1) RFID NEVER mutates custody — a rotation/verify never writes vt_equipment
 *       (seeded row is byte-for-byte identical before/after; no rows inserted).
 *   (3) every query clinicId-scoped; a cross-clinic rotationId resolves to NOT_FOUND.
 *   (7) ingest auth mechanism unchanged (same HMAC) — rotation only widens the set of
 *       accepted secrets to {current, previous} DURING the grace window.
 *
 * PINNED rotation contract (subspec R-M1.1c RED bullet):
 *   - secret returned ONCE (first success); never logged/cached.
 *   - same-key retry returns the original envelope (no second secret, no double-rotation).
 *   - two concurrent rotations → one wins, the other is rejected (no overwrite).
 *   - during grace either current OR previous verifies; after grace/ack previous is rejected.
 *   - rollback (while previous retained) restores previous as current + invalidates the new secret.
 *
 * DB-integration: needs DATABASE_URL + migration 173 applied. Self-skips when the
 * DB is unreachable (default CI runs without a DB — assertions gate on `dbReachable`).
 *
 * Run: DATABASE_URL=... pnpm test -- tests/rfid-provisioning.test.ts
 */
import "dotenv/config";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { Pool } from "pg";
import { createHmac, randomUUID } from "crypto";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
let probePool: Pool | null = null;
let dbReachable = false;
// Every clinic this suite seeds, so teardown can delete them (and their child
// rows) instead of leaving them behind to pollute a persistent integration DB.
const seededClinics = new Set<string>();

if (DATABASE_URL) {
  probePool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2500, max: 4 });
  try {
    await probePool.query("SELECT 1");
    const { rows } = await probePool.query<{ t: string | null }>(
      "SELECT to_regclass('public.vt_rfid_secret_rotations') AS t",
    );
    dbReachable = rows[0]?.t === "vt_rfid_secret_rotations";
  } catch {
    dbReachable = false;
  }
}

// ── Auth middleware mock (route-guard section only; the service is REAL) ──────
let currentAuthUser:
  | { id: string; email: string; clinicId: string; role: string }
  | null = null;

vi.mock("../server/middleware/auth.js", () => ({
  requireAuth: (req: Request, res: Response, next: NextFunction) => {
    if (!currentAuthUser) {
      res.status(401).json({ code: "UNAUTHORIZED", message: "Unauthorized", requestId: "t" });
      return;
    }
    (req as Request & { authUser?: unknown; clinicId?: string }).authUser = currentAuthUser;
    (req as Request & { clinicId?: string }).clinicId = currentAuthUser.clinicId;
    next();
  },
  requireAdmin: (req: Request, res: Response, next: NextFunction) => {
    const user = (req as Request & { authUser?: { role?: string } }).authUser;
    if (user?.role !== "admin") {
      res.status(403).json({ code: "FORBIDDEN", reason: "INSUFFICIENT_ROLE", message: "Admin required", requestId: "t" });
      return;
    }
    next();
  },
}));

// ── Credential-store injection (FS-1 finalize hardening) ──────────────────────
// A one-shot hook fired on the finalize-delete store (the `rfid` store that drops
// `previous_webhook_secret`). The service is otherwise REAL: the hook lets a test block or fail
// the durable delete to observe the intermediate `finalizing` state. Reset per-test.
const credHooks = vi.hoisted(() => ({
  beforeFinalizeDelete: null as null | (() => Promise<void>),
}));
vi.mock("../server/integrations/credential-manager.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/integrations/credential-manager.js")>();
  return {
    ...actual,
    storeCredentials: async (clinicId: string, adapterId: string, creds: Record<string, string>) => {
      const isFinalizeDelete = adapterId === "rfid" && !creds.previous_webhook_secret && !!creds.webhook_secret;
      if (isFinalizeDelete && credHooks.beforeFinalizeDelete) {
        const hook = credHooks.beforeFinalizeDelete;
        credHooks.beforeFinalizeDelete = null; // one-shot
        await hook();
      }
      return actual.storeCredentials(clinicId, adapterId, creds);
    },
  };
});

async function waitFor(cond: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error("waitFor: condition not met before timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
}

const uid = () => randomUUID();
const sign = (body: string, secret: string): string =>
  `sha256=${createHmac("sha256", secret).update(Buffer.from(body, "utf8")).digest("hex")}`;
const verify = (body: string, secret: string, header: string): boolean =>
  sign(body, secret) === header;

// ── Service under test (loaded once) ──────────────────────────────────────────
const {
  rotateRfidSecret,
  getRfidVerificationSecrets,
  ackRotationReader,
  rollbackRfidSecret,
  getRotation,
  RfidRotationError,
} = await import("../server/lib/rfid/provisioning.js");

async function seedClinic(pool: Pool, clinicId: string) {
  await pool.query("INSERT INTO vt_clinics (id) VALUES ($1) ON CONFLICT DO NOTHING", [clinicId]);
  seededClinics.add(clinicId);
}
async function seedReader(pool: Pool, clinicId: string, status = "active"): Promise<string> {
  const id = uid();
  await pool.query(
    "INSERT INTO vt_rfid_readers (id, clinic_id, name, gateway_code, status, provisioning_state) VALUES ($1,$2,$3,$4,$5,'unconfigured')",
    [id, clinicId, `reader-${id.slice(0, 6)}`, `gw-${id.slice(0, 8)}`, status],
  );
  return id;
}

afterAll(async () => {
  try {
    if (probePool && seededClinics.size > 0) {
      const ids = [...seededClinics];
      // Child rows first: vt_rfid_readers and vt_equipment both carry
      // clinic_id ON DELETE RESTRICT (deleting equipment cascades its rfid
      // reads/egress). vt_rfid_secret_rotations is clinic_id ON DELETE CASCADE,
      // so it clears when the clinic row goes.
      await probePool.query(`DELETE FROM vt_rfid_readers WHERE clinic_id = ANY($1)`, [ids]);
      await probePool.query(`DELETE FROM vt_equipment WHERE clinic_id = ANY($1)`, [ids]);
      await probePool.query(`DELETE FROM vt_clinics WHERE id = ANY($1)`, [ids]);
    }
  } finally {
    // Do not swallow a rejected Pool.end(): a teardown/resource failure must
    // surface from afterAll rather than pass silently.
    await probePool?.end();
  }
});

describe("R-M1.1c · HMAC rotation contract (DB-integration)", () => {
  beforeEach(() => {
    credHooks.beforeFinalizeDelete = null;
  });

  it.runIf(dbReachable)("first provision returns a secret ONCE; no previous to roll back", async () => {
    const clinic = `test-rfidp-${uid()}`;
    await seedClinic(probePool!, clinic);

    const env = await rotateRfidSecret(clinic, `key-${uid()}`);
    expect(env.secret).toBeTypeOf("string");
    expect(env.secret!.length).toBeGreaterThanOrEqual(32);
    expect(env.secretDelivered).toBe(true);
    expect(env.status).toBe("completed"); // no previous existed → nothing to grace
    expect(env.rollbackAvailable).toBe(false);

    // The new secret is the sole verifier.
    const secrets = await getRfidVerificationSecrets(clinic);
    expect(secrets).toEqual([env.secret]);

    // The persisted rotation record NEVER stores the plaintext secret.
    const rec = await getRotation(clinic, env.rotationId);
    expect(JSON.stringify(rec)).not.toContain(env.secret);
  });

  it.runIf(dbReachable)("rotate with active readers → grace: BOTH current and previous verify", async () => {
    const clinic = `test-rfidp-${uid()}`;
    await seedClinic(probePool!, clinic);
    await seedReader(probePool!, clinic);

    const first = await rotateRfidSecret(clinic, `key-${uid()}`);
    const second = await rotateRfidSecret(clinic, `key-${uid()}`, { graceTtlMs: 60_000 });

    expect(second.status).toBe("grace");
    expect(second.rollbackAvailable).toBe(true);
    expect(second.snapshotReaderIds.length).toBe(1);

    const secrets = await getRfidVerificationSecrets(clinic);
    expect(secrets).toHaveLength(2);
    const body = JSON.stringify({ batchId: "b1" });
    expect(secrets.some((s) => verify(body, second.secret!, sign(body, s)))).toBe(true); // new (current)
    expect(secrets.some((s) => verify(body, first.secret!, sign(body, s)))).toBe(true); // old (previous)
  });

  it.runIf(dbReachable)("same-key retry returns the ORIGINAL envelope — no second secret, no double-rotation", async () => {
    const clinic = `test-rfidp-${uid()}`;
    await seedClinic(probePool!, clinic);
    await seedReader(probePool!, clinic);
    await rotateRfidSecret(clinic, `key-${uid()}`);

    const key = `key-${uid()}`;
    const first = await rotateRfidSecret(clinic, key, { graceTtlMs: 60_000 });
    const secretsAfterFirst = await getRfidVerificationSecrets(clinic);

    const retry = await rotateRfidSecret(clinic, key, { graceTtlMs: 60_000 });
    expect(retry.rotationId).toBe(first.rotationId);
    expect(retry.secret).toBeUndefined(); // secret delivered once, never re-delivered
    expect(retry.secretDelivered).toBe(true);

    // No double-rotation: the verifying secret set is unchanged by the retry.
    const secretsAfterRetry = await getRfidVerificationSecrets(clinic);
    expect(secretsAfterRetry).toEqual(secretsAfterFirst);
  });

  it.runIf(dbReachable)("two concurrent rotations → exactly one wins, the other is rejected", async () => {
    const clinic = `test-rfidp-${uid()}`;
    await seedClinic(probePool!, clinic);
    await seedReader(probePool!, clinic);
    await rotateRfidSecret(clinic, `key-${uid()}`); // establish a current secret

    const results = await Promise.allSettled([
      rotateRfidSecret(clinic, `key-${uid()}`, { graceTtlMs: 60_000 }),
      rotateRfidSecret(clinic, `key-${uid()}`, { graceTtlMs: 60_000 }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const err = (rejected[0] as PromiseRejectedResult).reason;
    expect(err).toBeInstanceOf(RfidRotationError);
    expect(err.code).toBe("ROTATION_IN_PROGRESS");
  });

  it.runIf(dbReachable)("after grace EXPIRY the previous secret is rejected and rollback is unavailable", async () => {
    const clinic = `test-rfidp-${uid()}`;
    await seedClinic(probePool!, clinic);
    await seedReader(probePool!, clinic);
    const first = await rotateRfidSecret(clinic, `key-${uid()}`);
    const second = await rotateRfidSecret(clinic, `key-${uid()}`, { graceTtlMs: 1 });

    const past = Date.now() + 10_000;
    const secrets = await getRfidVerificationSecrets(clinic, past);
    expect(secrets).toEqual([second.secret]); // previous invalidated on expiry
    expect(secrets).not.toContain(first.secret);

    await expect(rollbackRfidSecret(clinic, second.rotationId, past)).rejects.toMatchObject({
      code: "ROLLBACK_UNAVAILABLE",
    });
  });

  it.runIf(dbReachable)("all-snapshot-readers acknowledged → previous invalidated + rollback unavailable at that instant", async () => {
    const clinic = `test-rfidp-${uid()}`;
    await seedClinic(probePool!, clinic);
    const readerId = await seedReader(probePool!, clinic);
    await rotateRfidSecret(clinic, `key-${uid()}`);
    const second = await rotateRfidSecret(clinic, `key-${uid()}`, { graceTtlMs: 600_000 });

    // Before ack: previous still verifies.
    expect(await getRfidVerificationSecrets(clinic)).toHaveLength(2);

    const acked = await ackRotationReader(clinic, second.rotationId, readerId);
    expect(acked.status).toBe("completed");
    expect(acked.rollbackAvailable).toBe(false);

    expect(await getRfidVerificationSecrets(clinic)).toEqual([second.secret]);
    await expect(rollbackRfidSecret(clinic, second.rotationId)).rejects.toMatchObject({
      code: "ROLLBACK_UNAVAILABLE",
    });
  });

  it.runIf(dbReachable)("contended finalize vs rollback: ack never reports 'completed' when rollback wins the race", async () => {
    const clinic = `test-rfidp-${uid()}`;
    // The it.runIf(dbReachable) guard implies probePool is initialised here.
    const pool = probePool;
    if (!pool) throw new Error("probePool must be initialised when dbReachable");
    await seedClinic(pool, clinic);
    const readerId = await seedReader(pool, clinic);
    await rotateRfidSecret(clinic, `key-${uid()}`);
    const second = await rotateRfidSecret(clinic, `key-${uid()}`, { graceTtlMs: 600_000 });

    // Race the all-readers-acked finalize against a rollback on the SAME grace rotation.
    // The ack transaction commits its "should finalize" decision, then finalizeRotation's
    // CAS races the rollback CAS — the exact window where the ack could otherwise report a
    // stale "completed" for a row that actually committed as "rolled_back".
    const [ackRes, rollbackRes] = await Promise.allSettled([
      ackRotationReader(clinic, second.rotationId, readerId),
      rollbackRfidSecret(clinic, second.rotationId),
    ]);

    const persisted = await getRotation(clinic, second.rotationId);
    // Narrow explicitly: the ack/rollback race always commits a terminal row for this rotation.
    if (!persisted) throw new Error("rotation row must exist after ack/rollback");
    expect(["completed", "rolled_back"]).toContain(persisted.status);

    // The ack must AGREE with the committed row — never claim "completed" while the row
    // committed as "rolled_back".
    expect(ackRes.status).toBe("fulfilled");
    if (ackRes.status === "fulfilled") {
      expect(ackRes.value.status).toBe(persisted.status);
      expect(ackRes.value.rollbackAvailable).toBe(false);
    }
    // The rollback either won (fulfilled → rolled_back) or lost (rejected UNAVAILABLE),
    // consistent with the committed terminal state.
    if (persisted.status === "rolled_back") {
      expect(rollbackRes.status).toBe("fulfilled");
    } else {
      expect(rollbackRes.status).toBe("rejected");
    }
  });

  // ── FS-1: `finalizing` intermediate state (transient-`completed` window closed) ──────────────
  it.runIf(dbReachable)("FS-1 happy path: grace → finalizing → completed, previous invalidated", async () => {
    const clinic = `test-rfidp-${uid()}`;
    await seedClinic(probePool!, clinic);
    const readerId = await seedReader(probePool!, clinic);
    await rotateRfidSecret(clinic, `key-${uid()}`);
    const second = await rotateRfidSecret(clinic, `key-${uid()}`, { graceTtlMs: 600_000 });
    expect(second.status).toBe("grace");

    // Observe the row is durably `finalizing` mid-delete (phase-1 CAS committed, delete not yet).
    let observedMid: string | undefined;
    credHooks.beforeFinalizeDelete = async () => {
      observedMid = (await getRotation(clinic, second.rotationId))?.status;
    };

    const acked = await ackRotationReader(clinic, second.rotationId, readerId);
    expect(observedMid).toBe("finalizing"); // grace → finalizing observed BEFORE completed
    expect(acked.status).toBe("completed"); // → completed ONLY after the durable delete
    expect(acked.rollbackAvailable).toBe(false);

    // Previous invalidated; only the new secret verifies.
    expect(await getRfidVerificationSecrets(clinic)).toEqual([second.secret]);
    expect((await getRotation(clinic, second.rotationId))?.previousRetained).toBe(false);
  });

  it.runIf(dbReachable)("FS-1: a credential-delete FAILURE during finalize reverts finalizing → grace; a concurrent read NEVER sees completed", async () => {
    const clinic = `test-rfidp-${uid()}`;
    await seedClinic(probePool!, clinic);
    const readerId = await seedReader(probePool!, clinic);
    const first = await rotateRfidSecret(clinic, `key-${uid()}`);
    const second = await rotateRfidSecret(clinic, `key-${uid()}`, { graceTtlMs: 600_000 });

    // Block the durable delete in the `finalizing` state, then FAIL it.
    let reachedFinalize = false;
    let release!: (fail: boolean) => void;
    const gate = new Promise<void>((resolve, reject) => {
      release = (fail) => (fail ? reject(new Error("injected credential-store delete failure")) : resolve());
    });
    credHooks.beforeFinalizeDelete = async () => {
      reachedFinalize = true;
      await gate;
    };

    // Kick off finalize (all readers acked) without awaiting — it parks in the blocked delete.
    const ackPromise = ackRotationReader(clinic, second.rotationId, readerId);
    await waitFor(() => reachedFinalize);

    // CONCURRENT observation while the row is `finalizing`: never `completed`.
    const midStatus = (await getRotation(clinic, second.rotationId))?.status;
    expect(midStatus).toBe("finalizing");
    expect(midStatus).not.toBe("completed");
    // Ingest still accepts previous — the blob delete has not committed.
    const midSecrets = await getRfidVerificationSecrets(clinic);
    expect(midSecrets).toHaveLength(2);
    expect(midSecrets).toContain(first.secret);
    expect(midSecrets).toContain(second.secret);

    // Fail the delete → revert to grace, surface the error, NEVER a terminal `completed`.
    release(true);
    await expect(ackPromise).rejects.toThrow(/injected credential-store delete failure/);

    const persisted = await getRotation(clinic, second.rotationId);
    expect(persisted?.status).toBe("grace");
    expect(persisted?.status).not.toBe("completed");
    expect(persisted?.previousRetained).toBe(true);
    // Recoverable: previous still verifies after the revert.
    expect(await getRfidVerificationSecrets(clinic)).toHaveLength(2);
  });

  it.runIf(dbReachable)("FS-1: rollback is REJECTED while the rotation is finalizing", async () => {
    const clinic = `test-rfidp-${uid()}`;
    await seedClinic(probePool!, clinic);
    const readerId = await seedReader(probePool!, clinic);
    await rotateRfidSecret(clinic, `key-${uid()}`);
    const second = await rotateRfidSecret(clinic, `key-${uid()}`, { graceTtlMs: 600_000 });

    let reachedFinalize = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    credHooks.beforeFinalizeDelete = async () => {
      reachedFinalize = true;
      await gate;
    };

    const ackPromise = ackRotationReader(clinic, second.rotationId, readerId);
    await waitFor(() => reachedFinalize);

    // The row is `finalizing` — rollback must be refused (valid only during `grace`).
    await expect(rollbackRfidSecret(clinic, second.rotationId)).rejects.toMatchObject({
      code: "ROLLBACK_UNAVAILABLE",
    });

    release();
    const acked = await ackPromise;
    expect(acked.status).toBe("completed");
  });

  it.runIf(dbReachable)("FS-1: getRfidVerificationSecrets returns [current, previous] while finalizing, [current] once the delete commits", async () => {
    const clinic = `test-rfidp-${uid()}`;
    await seedClinic(probePool!, clinic);
    const readerId = await seedReader(probePool!, clinic);
    const first = await rotateRfidSecret(clinic, `key-${uid()}`);
    const second = await rotateRfidSecret(clinic, `key-${uid()}`, { graceTtlMs: 600_000 });

    let reachedFinalize = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    credHooks.beforeFinalizeDelete = async () => {
      reachedFinalize = true;
      await gate;
    };

    const ackPromise = ackRotationReader(clinic, second.rotationId, readerId);
    await waitFor(() => reachedFinalize);

    // During `finalizing`, before the delete commits: both secrets verify.
    const during = await getRfidVerificationSecrets(clinic);
    expect(during).toEqual([second.secret, first.secret]);

    // Let the delete commit → [current] only.
    release();
    await ackPromise;
    expect(await getRfidVerificationSecrets(clinic)).toEqual([second.secret]);
  });

  it.runIf(dbReachable)("rollback within grace restores previous as current + invalidates the new secret", async () => {
    const clinic = `test-rfidp-${uid()}`;
    await seedClinic(probePool!, clinic);
    await seedReader(probePool!, clinic);
    const first = await rotateRfidSecret(clinic, `key-${uid()}`);
    const second = await rotateRfidSecret(clinic, `key-${uid()}`, { graceTtlMs: 600_000 });

    const rolled = await rollbackRfidSecret(clinic, second.rotationId);
    expect(rolled.status).toBe("rolled_back");

    const secrets = await getRfidVerificationSecrets(clinic);
    expect(secrets).toEqual([first.secret]); // previous restored as the sole current
    expect(secrets).not.toContain(second.secret); // the new secret is invalidated
  });

  it.runIf(dbReachable)("rotation with NO active readers completes immediately (previous invalidated, no rollback)", async () => {
    const clinic = `test-rfidp-${uid()}`;
    await seedClinic(probePool!, clinic);
    await seedReader(probePool!, clinic, "inactive"); // not eligible for the snapshot
    const first = await rotateRfidSecret(clinic, `key-${uid()}`);
    const second = await rotateRfidSecret(clinic, `key-${uid()}`, { graceTtlMs: 600_000 });

    expect(second.status).toBe("completed");
    expect(second.rollbackAvailable).toBe(false);
    expect(second.snapshotReaderIds).toHaveLength(0);
    const secrets = await getRfidVerificationSecrets(clinic);
    expect(secrets).toEqual([second.secret]);
    expect(secrets).not.toContain(first.secret);
  });

  it.runIf(dbReachable)("cross-clinic rotationId is NOT_FOUND — never rolled back/acked across tenants", async () => {
    const clinicA = `test-rfidp-a-${uid()}`;
    const clinicB = `test-rfidp-b-${uid()}`;
    await seedClinic(probePool!, clinicA);
    await seedClinic(probePool!, clinicB);
    await seedReader(probePool!, clinicA);
    await rotateRfidSecret(clinicA, `key-${uid()}`);
    const rot = await rotateRfidSecret(clinicA, `key-${uid()}`, { graceTtlMs: 600_000 });

    await expect(rollbackRfidSecret(clinicB, rot.rotationId)).rejects.toMatchObject({
      code: "ROTATION_NOT_FOUND",
    });
    await expect(ackRotationReader(clinicB, rot.rotationId, uid())).rejects.toMatchObject({
      code: "ROTATION_NOT_FOUND",
    });
    // clinicA's rotation is untouched — previous still verifies for A.
    expect(await getRfidVerificationSecrets(clinicA)).toHaveLength(2);
  });

  it.runIf(dbReachable)("GUARDRAIL (1): a rotation never mutates custody — vt_equipment is byte-for-byte unchanged", async () => {
    const clinic = `test-rfidp-${uid()}`;
    await seedClinic(probePool!, clinic);
    const eqId = uid();
    await probePool!.query(
      "INSERT INTO vt_equipment (id, name, clinic_id) VALUES ($1,$2,$3)",
      [eqId, "cust-probe", clinic],
    );
    const before = await probePool!.query("SELECT * FROM vt_equipment WHERE id=$1", [eqId]);

    await seedReader(probePool!, clinic);
    await rotateRfidSecret(clinic, `key-${uid()}`);
    const r = await rotateRfidSecret(clinic, `key-${uid()}`, { graceTtlMs: 600_000 });
    await getRfidVerificationSecrets(clinic);
    await rollbackRfidSecret(clinic, r.rotationId);

    const after = await probePool!.query("SELECT * FROM vt_equipment WHERE id=$1", [eqId]);
    const countAll = await probePool!.query(
      "SELECT count(*)::int AS c FROM vt_equipment WHERE clinic_id=$1",
      [clinic],
    );
    expect(after.rows[0]).toEqual(before.rows[0]); // no custody / lastRfid mutation
    expect(countAll.rows[0].c).toBe(1); // no rows inserted by the RFID path
  });

  it.runIf(dbReachable)("the plaintext secret is never written to console (not logged)", async () => {
    const clinic = `test-rfidp-${uid()}`;
    await seedClinic(probePool!, clinic);
    await seedReader(probePool!, clinic);
    const seen: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
        seen.push(a.map(String).join(" "));
      }),
    );
    try {
      await rotateRfidSecret(clinic, `key-${uid()}`);
      const env = await rotateRfidSecret(clinic, `key-${uid()}`, { graceTtlMs: 600_000 });
      expect(seen.join("\n")).not.toContain(env.secret);
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });
});

// ── Route guards: admin-only + clinicId-from-auth (real router + real service) ─
type Captured = { statusCode: number; body: unknown };
function makeRes(): { res: Response; captured: Captured } {
  const captured: Captured = { statusCode: 200, body: null };
  const headers = new Map<string, string>();
  const res = {
    status(code: number) { captured.statusCode = code; return this; },
    json(payload: unknown) { captured.body = payload; return this; },
    setHeader(name: string, value: string) { headers.set(name.toLowerCase(), value); },
    getHeader(name: string) { return headers.get(name.toLowerCase()); },
  } as unknown as Response;
  return { res, captured };
}
function makeReq(o: { method: string; url: string; body?: unknown; params?: Record<string, string> }): Request {
  return {
    method: o.method, url: o.url, originalUrl: o.url, baseUrl: "",
    body: o.body ?? {}, headers: {}, params: o.params ?? {}, query: {},
  } as unknown as Request;
}
async function dispatch(req: Request, res: Response): Promise<void> {
  const { default: router } = await import("../server/routes/admin-rfid-provisioning.js");
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => { if (settled) return; settled = true; resolve(); };
    const origJson = res.json.bind(res);
    (res as Response).json = (payload: unknown) => { const r = origJson(payload); setImmediate(finish); return r; };
    (router as unknown as (req: Request, res: Response, next: (e?: unknown) => void) => void)(req, res, (err?: unknown) => {
      if (err) console.error("router next error", err);
      finish();
    });
    setTimeout(finish, 400);
  });
}

describe("R-M1.1c · route guards", () => {
  beforeEach(() => {
    currentAuthUser = { id: "u-admin", email: "a@c.test", clinicId: `route-clinic-${uid()}`, role: "admin" };
  });

  it("rejects a non-admin with 403", async () => {
    currentAuthUser = { id: "u-vet", email: "v@c.test", clinicId: "c1", role: "vet" };
    const { res, captured } = makeRes();
    await dispatch(makeReq({ method: "POST", url: "/rfid-provisioning/rotate", body: { idempotencyKey: uid() } }), res);
    expect(captured.statusCode).toBe(403);
  });

  it.runIf(dbReachable)("derives clinicId from auth ONLY — a body clinicId is ignored", async () => {
    const authedClinic = currentAuthUser!.clinicId;
    await seedClinic(probePool!, authedClinic);
    const { res, captured } = makeRes();
    await dispatch(
      makeReq({ method: "POST", url: "/rfid-provisioning/rotate", body: { idempotencyKey: uid(), clinicId: "attacker-clinic" } }),
      res,
    );
    expect(captured.statusCode).toBe(201);
    const rotationId = (captured.body as { rotation?: { rotationId?: string } }).rotation?.rotationId;
    expect(rotationId).toBeTypeOf("string");
    // The rotation lives under the AUTHED clinic, never the body-supplied one.
    expect(await getRotation(authedClinic, rotationId!)).not.toBeNull();
    expect(await getRotation("attacker-clinic", rotationId!)).toBeNull();
  });
});
