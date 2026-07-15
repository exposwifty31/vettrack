/**
 * P2 contradiction wiring (T2.7) — Postgres integration tests.
 *
 * Covers the two anchor contradictions (D-13): checkout invalidates the
 * item's current anchor with reason "checkout", and an RFID read placing
 * the item in a room different from its anchor's station room invalidates
 * it with reason "rfid_elsewhere". An RFID read into the anchor's own
 * station room, and either mutation when no anchor is currently open, are
 * no-ops. Both seams are fire-and-forget — invalidation must never block or
 * fail the primary mutation (checkout / RFID ingest).
 *
 * Requires DATABASE_URL and migrations 164 (docks room/asset_type/capacity)
 * + 165 (vt_equipment_anchors).
 * Run: pnpm test tests/docking-anchor-contradictions.integration.test.ts
 */

import "dotenv/config";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { randomUUID } from "crypto";

// Both seams write audit-relevant rows via server/lib/audit.js in the real
// implementation (rfid-ingest's room-changed branch calls logAudit inside its
// tx). vt_audit_logs is append-only (DELETE is a silent no-op) with a
// RESTRICT clinic FK, so a real audit row would make this suite's throwaway
// clinics permanently undeletable. Mock it, same as tests/rfid-ingest.test.ts.
vi.mock("../server/lib/audit.js", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
  resolveAuditActorRole: () => "system",
}));

const DATABASE_URL = process.env.DATABASE_URL ?? "";
let probePool: Pool | null = null;
let dbReachable = false;

const { createAnchor, getCurrentAnchor } = await import("../server/services/equipment-anchor.service.js");
const { performEquipmentCheckout } = await import("../server/services/equipment-custody-toggle.service.js");
const { ingestRfidBatch } = await import("../server/lib/rfid-ingest.js");
const { db } = await import("../server/db.js");

async function seedClinic(clinicId: string) {
  await probePool!.query(`INSERT INTO vt_clinics (id) VALUES ($1) ON CONFLICT DO NOTHING`, [clinicId]);
}

async function seedRoom(roomId: string, clinicId: string, name: string, gatewayCode: string | null = null) {
  await probePool!.query(
    `INSERT INTO vt_rooms (id, clinic_id, name, gateway_code, sync_status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'stale', now(), now())`,
    [roomId, clinicId, name, gatewayCode],
  );
}

async function seedAssetType(assetTypeId: string, clinicId: string, name: string) {
  await probePool!.query(
    `INSERT INTO vt_asset_types (id, clinic_id, name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [assetTypeId, clinicId, name],
  );
}

async function seedDock(dockId: string, clinicId: string, roomId: string, assetTypeId: string) {
  await probePool!.query(
    `INSERT INTO vt_docks (id, clinic_id, name, room_id, asset_type_id, capacity)
     VALUES ($1, $2, $3, $4, $5, 4) ON CONFLICT DO NOTHING`,
    [dockId, clinicId, `Dock ${dockId.slice(0, 8)}`, roomId, assetTypeId],
  );
}

async function seedEquipment(params: {
  id: string;
  clinicId: string;
  rfidTagEpc?: string | null;
  lastRfidRoomId?: string | null;
}) {
  await probePool!.query(
    `INSERT INTO vt_equipment
       (id, clinic_id, name, status, version, custody_state, usage_state, readiness_state, rfid_tag_epc, last_rfid_room_id)
     VALUES ($1, $2, $3, 'ok', 1, 'returned', 'available', 'unknown', $4, $5)`,
    [
      params.id,
      params.clinicId,
      "Anchor Contradiction Test Pump",
      params.rfidTagEpc ?? null,
      params.lastRfidRoomId ?? null,
    ],
  );
}

async function purgeClinic(clinicId: string) {
  const P = probePool!;
  await P.query(`DELETE FROM vt_equipment_anchors WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_equipment_rfid_reads WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_event_outbox WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_undo_tokens WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_scan_logs WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_equipment WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_docks WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_asset_types WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_rooms WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_clinics WHERE id = $1`, [clinicId]);
}

async function anchorRow(anchorId: string) {
  const { rows } = await probePool!.query<{ invalidated_at: Date | null; invalidated_reason: string | null }>(
    `SELECT invalidated_at, invalidated_reason FROM vt_equipment_anchors WHERE id = $1`,
    [anchorId],
  );
  return rows[0] ?? null;
}

/**
 * Both seams invalidate fire-and-forget (never awaited by the caller), so
 * assertions on the anchor row must poll rather than check synchronously
 * after the primary mutation returns.
 */
async function waitForAnchorInvalidated(anchorId: string, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = await anchorRow(anchorId);
    if (row?.invalidated_at) return row;
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for anchor ${anchorId} to be invalidated`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Polls across a settle window to confirm the anchor never flips to invalidated. */
async function assertAnchorStaysOpen(anchorId: string, windowMs = 500) {
  const deadline = Date.now() + windowMs;
  while (Date.now() < deadline) {
    const row = await anchorRow(anchorId);
    expect(row?.invalidated_at).toBeNull();
    await new Promise((r) => setTimeout(r, 25));
  }
}

interface Ctx {
  clinicId: string;
}
let ctx: Ctx;

describe.skipIf(!DATABASE_URL)("docking anchor contradictions (T2.7) integration", () => {
  beforeAll(async () => {
    if (!DATABASE_URL) throw new Error("DATABASE_URL required");

    probePool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000, max: 4 });

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
    ctx = { clinicId: randomUUID() };
    await seedClinic(ctx.clinicId);
  });

  afterEach(async () => {
    await purgeClinic(ctx.clinicId);
  });

  it("confirms the DB was actually reached (sanity)", () => {
    expect(dbReachable).toBe(true);
  });

  describe("checkout contradiction", () => {
    it("performEquipmentCheckout invalidates the current anchor with reason=checkout", async () => {
      const eqId = randomUUID();
      await seedEquipment({ id: eqId, clinicId: ctx.clinicId });

      const anchor = await createAnchor(db, {
        clinicId: ctx.clinicId,
        equipmentId: eqId,
        source: "citizen",
      });
      expect(anchor.invalidatedAt).toBeNull();

      const checkoutResult = await db.transaction((tx) =>
        performEquipmentCheckout(tx, {
          clinicId: ctx.clinicId,
          equipmentId: eqId,
          actor: { id: randomUUID(), email: "tech@ops.local" },
        }),
      );
      expect(checkoutResult).not.toBeNull();
      expect(checkoutResult?.updated.custodyState).toBe("checked_out");

      const row = await waitForAnchorInvalidated(anchor.id);
      expect(row.invalidated_reason).toBe("checkout");

      const current = await getCurrentAnchor(ctx.clinicId, eqId);
      expect(current).toBeNull();
    });

    it("checkout with no current anchor proceeds without error (no-op invalidation)", async () => {
      const eqId = randomUUID();
      await seedEquipment({ id: eqId, clinicId: ctx.clinicId });

      const checkoutResult = await db.transaction((tx) =>
        performEquipmentCheckout(tx, {
          clinicId: ctx.clinicId,
          equipmentId: eqId,
          actor: { id: randomUUID(), email: "tech@ops.local" },
        }),
      );
      expect(checkoutResult).not.toBeNull();
      expect(checkoutResult?.updated.custodyState).toBe("checked_out");

      const current = await getCurrentAnchor(ctx.clinicId, eqId);
      expect(current).toBeNull();
    });
  });

  describe("rfid-elsewhere contradiction", () => {
    it("an RFID read into a room different from the anchor's station invalidates it with reason=rfid_elsewhere", async () => {
      const stationRoomId = randomUUID();
      const elsewhereRoomId = randomUUID();
      const assetTypeId = randomUUID();
      const dockId = randomUUID();
      const eqId = randomUUID();
      const tagEpc = `EPC-${randomUUID().slice(0, 8)}`;
      const stationGateway = `GW-STA-${randomUUID().slice(0, 6)}`;
      const elsewhereGateway = `GW-ELS-${randomUUID().slice(0, 6)}`;

      await seedRoom(stationRoomId, ctx.clinicId, "Station Room", stationGateway);
      await seedRoom(elsewhereRoomId, ctx.clinicId, "Elsewhere Room", elsewhereGateway);
      await seedAssetType(assetTypeId, ctx.clinicId, "Infusion Pump");
      await seedDock(dockId, ctx.clinicId, stationRoomId, assetTypeId);
      // lastRfidRoomId starts null so the elsewhere-room read is a room change.
      await seedEquipment({ id: eqId, clinicId: ctx.clinicId, rfidTagEpc: tagEpc, lastRfidRoomId: null });

      const anchor = await createAnchor(db, {
        clinicId: ctx.clinicId,
        equipmentId: eqId,
        dockId,
        source: "citizen",
      });
      expect(anchor.invalidatedAt).toBeNull();

      const result = await ingestRfidBatch(ctx.clinicId, {
        batchId: `rfid-elsewhere-${randomUUID().slice(0, 8)}`,
        events: [{ tagEpc, gatewayCode: elsewhereGateway, readAt: new Date().toISOString() }],
      });
      expect(result.updated).toBe(1);

      const row = await waitForAnchorInvalidated(anchor.id);
      expect(row.invalidated_reason).toBe("rfid_elsewhere");

      const current = await getCurrentAnchor(ctx.clinicId, eqId);
      expect(current).toBeNull();
    });

    it("an RFID read into the anchor's own station room does NOT invalidate it (stays open)", async () => {
      const stationRoomId = randomUUID();
      const otherRoomId = randomUUID();
      const assetTypeId = randomUUID();
      const dockId = randomUUID();
      const eqId = randomUUID();
      const tagEpc = `EPC-${randomUUID().slice(0, 8)}`;
      const stationGateway = `GW-STA-${randomUUID().slice(0, 6)}`;
      const otherGateway = `GW-OTH-${randomUUID().slice(0, 6)}`;

      await seedRoom(stationRoomId, ctx.clinicId, "Station Room", stationGateway);
      await seedRoom(otherRoomId, ctx.clinicId, "Other Room", otherGateway);
      await seedAssetType(assetTypeId, ctx.clinicId, "Infusion Pump");
      await seedDock(dockId, ctx.clinicId, stationRoomId, assetTypeId);
      // lastRfidRoomId starts at the OTHER room so the read into the station
      // room is still a "room change" from the equipment's own RFID history —
      // exercising the station-room comparison, not the roomUnchanged skip.
      await seedEquipment({ id: eqId, clinicId: ctx.clinicId, rfidTagEpc: tagEpc, lastRfidRoomId: otherRoomId });

      const anchor = await createAnchor(db, {
        clinicId: ctx.clinicId,
        equipmentId: eqId,
        dockId,
        source: "citizen",
      });
      expect(anchor.invalidatedAt).toBeNull();

      const result = await ingestRfidBatch(ctx.clinicId, {
        batchId: `rfid-same-station-${randomUUID().slice(0, 8)}`,
        events: [{ tagEpc, gatewayCode: stationGateway, readAt: new Date().toISOString() }],
      });
      expect(result.updated).toBe(1);

      await assertAnchorStaysOpen(anchor.id);

      const current = await getCurrentAnchor(ctx.clinicId, eqId);
      expect(current?.id).toBe(anchor.id);
    });

    it("no room change (roomUnchanged) does NOT invalidate the anchor (stays open)", async () => {
      const stationRoomId = randomUUID();
      const assetTypeId = randomUUID();
      const dockId = randomUUID();
      const eqId = randomUUID();
      const tagEpc = `EPC-${randomUUID().slice(0, 8)}`;
      const stationGateway = `GW-STA-${randomUUID().slice(0, 6)}`;

      await seedRoom(stationRoomId, ctx.clinicId, "Station Room", stationGateway);
      await seedAssetType(assetTypeId, ctx.clinicId, "Infusion Pump");
      await seedDock(dockId, ctx.clinicId, stationRoomId, assetTypeId);
      // lastRfidRoomId already equals the station room — the incoming event
      // is roomUnchanged, so the contradiction branch never runs at all.
      await seedEquipment({ id: eqId, clinicId: ctx.clinicId, rfidTagEpc: tagEpc, lastRfidRoomId: stationRoomId });

      const anchor = await createAnchor(db, {
        clinicId: ctx.clinicId,
        equipmentId: eqId,
        dockId,
        source: "citizen",
      });

      const result = await ingestRfidBatch(ctx.clinicId, {
        batchId: `rfid-unchanged-${randomUUID().slice(0, 8)}`,
        events: [{ tagEpc, gatewayCode: stationGateway, readAt: new Date().toISOString() }],
      });
      expect(result.unchanged).toBe(1);

      await assertAnchorStaysOpen(anchor.id);

      const current = await getCurrentAnchor(ctx.clinicId, eqId);
      expect(current?.id).toBe(anchor.id);
    });

    it("RFID room change with no current anchor proceeds without error (no-op invalidation)", async () => {
      const elsewhereRoomId = randomUUID();
      const eqId = randomUUID();
      const tagEpc = `EPC-${randomUUID().slice(0, 8)}`;
      const gatewayCode = `GW-${randomUUID().slice(0, 6)}`;

      await seedRoom(elsewhereRoomId, ctx.clinicId, "Elsewhere Room", gatewayCode);
      await seedEquipment({ id: eqId, clinicId: ctx.clinicId, rfidTagEpc: tagEpc, lastRfidRoomId: null });

      const result = await ingestRfidBatch(ctx.clinicId, {
        batchId: `rfid-no-anchor-${randomUUID().slice(0, 8)}`,
        events: [{ tagEpc, gatewayCode, readAt: new Date().toISOString() }],
      });
      expect(result.updated).toBe(1);

      const current = await getCurrentAnchor(ctx.clinicId, eqId);
      expect(current).toBeNull();
    });
  });
});
