/**
 * Anchor service (T2.2) — Postgres integration tests.
 *
 * Covers createAnchor (supersede prior open anchor), invalidateCurrentAnchor
 * (contradiction, idempotent no-op when nothing open), and getCurrentAnchor
 * against the real vt_equipment_anchors table (migration 165).
 *
 * Self-skipping: requires DATABASE_URL and the vt_equipment_anchors table.
 * Run: pnpm test tests/equipment-anchor.service.integration.test.ts
 */

import "dotenv/config";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { randomUUID } from "crypto";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
let probePool: Pool | null = null;
let dbReachable = false;

// Deferred until beforeAll (after the describe.skipIf guard) so a genuinely
// unset DATABASE_URL never forces server/db.js to construct a connection
// pool at module-import time — it would throw before the skip guard gets a
// chance to run. Mirrors tests/docking-citizen-anchor.integration.test.ts.
type AnchorService = typeof import("../server/services/equipment-anchor.service.js");
type DbModule = typeof import("../server/db.js");
let createAnchor: AnchorService["createAnchor"];
let invalidateCurrentAnchor: AnchorService["invalidateCurrentAnchor"];
let getCurrentAnchor: AnchorService["getCurrentAnchor"];
let db: DbModule["db"];

async function seedClinic(clinicId: string) {
  await probePool!.query(`INSERT INTO vt_clinics (id) VALUES ($1) ON CONFLICT DO NOTHING`, [clinicId]);
}

async function seedEquipment(eqId: string, clinicId: string) {
  await probePool!.query(
    `INSERT INTO vt_equipment (id, clinic_id, name, status, version) VALUES ($1, $2, $3, 'ok', 1)`,
    [eqId, clinicId, "Test Anchor Pump"],
  );
}

async function purgeClinic(clinicId: string) {
  const P = probePool!;
  await P.query(`DELETE FROM vt_equipment_anchors WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_equipment WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_clinics WHERE id = $1`, [clinicId]);
}

async function anchorRow(anchorId: string) {
  const { rows } = await probePool!.query<{ invalidated_at: Date | null; invalidated_reason: string | null }>(
    `SELECT invalidated_at, invalidated_reason FROM vt_equipment_anchors WHERE id = $1`,
    [anchorId],
  );
  return rows[0] ?? null;
}

interface Ctx {
  clinicId: string;
  equipmentId: string;
}
let ctx: Ctx;

/**
 * Polls pg_stat_activity until the given backend is actually waiting on a
 * lock, instead of assuming a fixed amount of async-scheduling time is
 * enough — under heavy concurrent DB load (e.g. the full test suite hitting
 * the same shared Postgres instance in parallel) a timing-only assumption
 * can flake, since "issued but not yet awaited" doesn't guarantee the
 * statement has actually reached the server and started waiting.
 */
async function waitUntilBlockedOnLock(pool: Pool, backendPid: number, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await pool.query<{ wait_event_type: string | null }>(
      `SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1`,
      [backendPid],
    );
    if (rows[0]?.wait_event_type === "Lock") return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(`Backend ${backendPid} never entered a Lock wait state within ${timeoutMs}ms`);
}

describe.skipIf(!DATABASE_URL)("equipment-anchor.service integration", () => {
  beforeAll(async () => {
    if (!DATABASE_URL) throw new Error("DATABASE_URL required");

    ({ createAnchor, invalidateCurrentAnchor, getCurrentAnchor } = await import(
      "../server/services/equipment-anchor.service.js"
    ));
    ({ db } = await import("../server/db.js"));

    // max: 3, not 2 — the concurrent-createAnchor test below checks out two
    // dedicated connections (clientA, clientB) AND uses probePool itself to
    // poll pg_stat_activity while both are held; max: 2 would self-deadlock
    // that poll waiting for a connection neither client will release yet.
    probePool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000, max: 3 });

    try {
      await probePool.query("SELECT 1");
      const { rows } = await probePool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_name = 'vt_equipment_anchors'`,
      );
      if (rows.length !== 1) {
        throw new Error("vt_equipment_anchors table missing (migration 165 not applied?)");
      }
      dbReachable = true;
    } catch (err) {
      if (probePool) {
        await probePool.end();
        probePool = null;
      }
      throw new Error(`Database connection or schema validation failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  afterAll(async () => {
    if (probePool) {
      await probePool.end();
      probePool = null;
    }
  });

  beforeEach(async () => {
    ctx = { clinicId: randomUUID(), equipmentId: randomUUID() };
    await seedClinic(ctx.clinicId);
    await seedEquipment(ctx.equipmentId, ctx.clinicId);
  });

  afterEach(async () => {
    await purgeClinic(ctx.clinicId);
  });

  it("confirms the DB was actually reached (sanity)", () => {
    expect(dbReachable).toBe(true);
  });

  it("createAnchor → getCurrentAnchor returns it, open (invalidatedAt null)", async () => {
    const created = await createAnchor(db, {
      clinicId: ctx.clinicId,
      equipmentId: ctx.equipmentId,
      source: "citizen",
    });
    expect(created.invalidatedAt).toBeNull();
    expect(created.clinicId).toBe(ctx.clinicId);
    expect(created.equipmentId).toBe(ctx.equipmentId);
    expect(created.source).toBe("citizen");

    const current = await getCurrentAnchor(ctx.clinicId, ctx.equipmentId);
    expect(current?.id).toBe(created.id);
    expect(current?.invalidatedAt).toBeNull();
  });

  it("a second createAnchor supersedes the first (invalidated_at set, reason NULL) and becomes current", async () => {
    const first = await createAnchor(db, {
      clinicId: ctx.clinicId,
      equipmentId: ctx.equipmentId,
      source: "return_toggle",
    });
    const second = await createAnchor(db, {
      clinicId: ctx.clinicId,
      equipmentId: ctx.equipmentId,
      source: "sweep",
    });

    const firstRow = await anchorRow(first.id);
    expect(firstRow?.invalidated_at).not.toBeNull();
    expect(firstRow?.invalidated_reason).toBeNull();

    const current = await getCurrentAnchor(ctx.clinicId, ctx.equipmentId);
    expect(current?.id).toBe(second.id);
    expect(current?.invalidatedAt).toBeNull();
  });

  it("invalidateCurrentAnchor(reason: checkout) contradicts the open anchor; getCurrentAnchor returns null", async () => {
    const created = await createAnchor(db, {
      clinicId: ctx.clinicId,
      equipmentId: ctx.equipmentId,
      source: "smart_charger",
    });

    await invalidateCurrentAnchor(db, {
      clinicId: ctx.clinicId,
      equipmentId: ctx.equipmentId,
      reason: "checkout",
    });

    const row = await anchorRow(created.id);
    expect(row?.invalidated_at).not.toBeNull();
    expect(row?.invalidated_reason).toBe("checkout");

    const current = await getCurrentAnchor(ctx.clinicId, ctx.equipmentId);
    expect(current).toBeNull();
  });

  it("invalidateCurrentAnchor is idempotent — a no-op (no throw) when no open anchor exists", async () => {
    await expect(
      invalidateCurrentAnchor(db, {
        clinicId: ctx.clinicId,
        equipmentId: ctx.equipmentId,
        reason: "rfid_elsewhere",
      }),
    ).resolves.toBeUndefined();

    const current = await getCurrentAnchor(ctx.clinicId, ctx.equipmentId);
    expect(current).toBeNull();
  });

  it("two concurrent createAnchor calls (each in its own transaction) for the same item leave exactly one open anchor (D-13 unique-index guarantee)", async () => {
    // A plain Promise.all of two db.transaction(createAnchor) calls is not
    // reliable here: on fast local Postgres the two transactions tend to run
    // effectively sequentially (each supersedes the other cleanly), so the
    // invariant would hold trivially with or without the unique index and
    // the test would never actually exercise the race it's meant to guard.
    // Instead we force genuine interleaving with two manually-driven
    // connections, running the exact UPDATE/INSERT pair createAnchor runs
    // (see server/services/equipment-anchor.service.ts), racing a second
    // writer's INSERT against a first writer's already-committed one.
    const initial = await createAnchor(db, {
      clinicId: ctx.clinicId,
      equipmentId: ctx.equipmentId,
      source: "return_toggle",
    });

    const updateSql = `UPDATE vt_equipment_anchors SET invalidated_at = now()
       WHERE clinic_id = $1 AND equipment_id = $2 AND invalidated_at IS NULL`;
    const insertSql = `INSERT INTO vt_equipment_anchors (id, clinic_id, equipment_id, source) VALUES ($1, $2, $3, $4)`;
    const idA = randomUUID();
    const idB = randomUUID();

    const clientA = await probePool!.connect();
    const clientB = await probePool!.connect();
    let bRejected = false;
    try {
      await clientA.query("BEGIN");
      await clientB.query("BEGIN");

      // A supersedes + inserts + commits first.
      await clientA.query(updateSql, [ctx.clinicId, ctx.equipmentId]);
      // B's UPDATE is issued (not yet awaited) while A still holds the row
      // lock. Confirm B is GENUINELY blocked on that lock (not just "issued
      // but who knows if it's arrived yet") before letting A proceed, so the
      // interleaving is guaranteed rather than timing-assumed.
      const updateB = clientB.query(updateSql, [ctx.clinicId, ctx.equipmentId]);
      await waitUntilBlockedOnLock(probePool!, clientB.processID!);
      await clientA.query(insertSql, [idA, ctx.clinicId, ctx.equipmentId, "citizen"]);
      await clientA.query("COMMIT");

      // Unblocks now that A committed: re-evaluated against current data, A's
      // row no longer matches (invalidated_at IS NULL), so this affects 0
      // rows — matching createAnchor's own supersede semantics.
      await updateB;

      try {
        await clientB.query(insertSql, [idB, ctx.clinicId, ctx.equipmentId, "sweep"]);
        await clientB.query("COMMIT");
      } catch {
        bRejected = true;
        await clientB.query("ROLLBACK");
      }
    } finally {
      clientA.release();
      clientB.release();
    }

    // The unique index is the DB-level guarantee: B's insert — racing A's
    // already-committed open row for the same item — must be rejected
    // rather than silently coexisting as a second open anchor.
    expect(bRejected).toBe(true);

    const { rows } = await probePool!.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM vt_equipment_anchors
       WHERE clinic_id = $1 AND equipment_id = $2 AND invalidated_at IS NULL`,
      [ctx.clinicId, ctx.equipmentId],
    );
    expect(rows[0]?.count).toBe(1);

    const current = await getCurrentAnchor(ctx.clinicId, ctx.equipmentId);
    expect(current?.id).toBe(idA);
    expect(current?.id).not.toBe(initial.id);
  });

  it("getCurrentAnchor is clinic-scoped — another clinic's id never sees this anchor", async () => {
    const otherClinicId = randomUUID();
    await seedClinic(otherClinicId);

    try {
      await createAnchor(db, { clinicId: ctx.clinicId, equipmentId: ctx.equipmentId, source: "citizen" });
      // No anchor row was ever written with clinic_id = otherClinicId, so querying
      // under the wrong clinic must not surface the other clinic's open anchor.
      const crossClinic = await getCurrentAnchor(otherClinicId, ctx.equipmentId);
      expect(crossClinic).toBeNull();
    } finally {
      await purgeClinic(otherClinicId);
    }
  });
});
