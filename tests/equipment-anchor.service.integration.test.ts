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

const {
  createAnchor,
  invalidateCurrentAnchor,
  getCurrentAnchor,
} = await import("../server/services/equipment-anchor.service.js");
const { db } = await import("../server/db.js");

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

describe.skipIf(!DATABASE_URL)("equipment-anchor.service integration", () => {
  beforeAll(async () => {
    if (!DATABASE_URL) throw new Error("DATABASE_URL required");

    probePool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000, max: 2 });

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
