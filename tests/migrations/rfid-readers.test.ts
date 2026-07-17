/**
 * R-M1.1a — Managed reader entity `vt_rfid_readers` (directional + tenant-safe at the DB boundary).
 *
 * Validates migration 172_vt_rfid_readers.sql:
 *   - directional columns exist (gate_type, from_room_id, to_room_id, room_id, last_reader_heartbeat_at, …)
 *   - composite UNIQUE (clinic_id, gateway_code) rejects duplicates
 *   - composite FKs enforce same-clinic on room_id / from_room_id / to_room_id (nullable endpoints exempt)
 *   - directional-pair validity + roomId-membership fire ONLY when gate_type is SET
 *   - a legacy_unconfigured reader (gate_type UNSET, room_id set, both endpoints NULL) is ACCEPTED
 *   - one-time backfill: each rooms.gateway_code → a managed reader (legacy_unconfigured), so the
 *     gateway registry (ingest gateway resolution) lives in vt_rfid_readers, not just rooms.gateway_code
 *
 * FROZEN R-M1 guardrail: tenant safety is enforced IN THE DB (composite unique + composite FKs),
 * not merely in service queries.
 *
 * Run: pnpm exec tsx tests/migrations/rfid-readers.test.ts   (DB-integration; needs DATABASE_URL + migrations)
 */
import "dotenv/config";
import assert from "node:assert";
import { randomUUID } from "crypto";

const uid = () => randomUUID();

async function expectReject(
  fn: () => Promise<unknown>,
  message: string,
): Promise<void> {
  let threw = false;
  try {
    await fn();
  } catch {
    threw = true;
  }
  assert.ok(threw, message);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("⚠️  rfid-readers migration test skipped (DATABASE_URL not set)");
    process.exit(0);
  }

  const { pool } = await import("../../server/db.js");

  // Track everything we create so the finally block cleans up regardless of assertion outcome.
  const clinicIds: string[] = [];

  try {
    // --- table exists ---
    const tableExists = await pool.query(
      `select to_regclass('public.vt_rfid_readers') as t`,
    );
    assert.strictEqual(
      tableExists.rows[0].t,
      "vt_rfid_readers",
      "expected vt_rfid_readers table to exist",
    );

    // --- directional + health columns exist ---
    const cols = await pool.query(
      `select column_name, is_nullable from information_schema.columns
       where table_name = 'vt_rfid_readers'`,
    );
    const colMap = new Map<string, string>(
      cols.rows.map((r: { column_name: string; is_nullable: string }) => [
        r.column_name,
        r.is_nullable,
      ]),
    );
    for (const c of [
      "clinic_id",
      "id",
      "name",
      "gateway_code",
      "room_id",
      "from_room_id",
      "to_room_id",
      "gate_type",
      "physical_location",
      "status",
      "last_seen_at",
      "last_reader_heartbeat_at",
      "provisioning_state",
      "created_at",
    ]) {
      assert.ok(colMap.has(c), `expected vt_rfid_readers.${c} column to exist`);
    }
    // clinic_id + gateway_code are the tenant/registry spine → NOT NULL
    assert.strictEqual(colMap.get("clinic_id"), "NO", "clinic_id must be NOT NULL");
    assert.strictEqual(colMap.get("gateway_code"), "NO", "gateway_code must be NOT NULL");
    // directional endpoints are nullable (external zone = NULL)
    assert.strictEqual(colMap.get("from_room_id"), "YES", "from_room_id must be nullable");
    assert.strictEqual(colMap.get("to_room_id"), "YES", "to_room_id must be nullable");
    assert.strictEqual(colMap.get("gate_type"), "YES", "gate_type must be nullable");

    // --- helpers to seed a clinic + rooms ---
    async function seedClinic(): Promise<{ clinicId: string; roomA: string; roomB: string }> {
      const clinicId = uid();
      clinicIds.push(clinicId);
      await pool.query(`insert into vt_clinics (id) values ($1)`, [clinicId]);
      const roomA = uid();
      const roomB = uid();
      await pool.query(
        `insert into vt_rooms (id, clinic_id, name) values ($1, $2, $3), ($4, $2, $5)`,
        [roomA, clinicId, `Room-A-${roomA.slice(0, 6)}`, roomB, `Room-B-${roomB.slice(0, 6)}`],
      );
      return { clinicId, roomA, roomB };
    }

    async function insertReader(fields: Record<string, unknown>): Promise<void> {
      const base: Record<string, unknown> = {
        id: uid(),
        name: "Reader",
        gateway_code: `gw-${uid().slice(0, 8)}`,
        room_id: null,
        from_room_id: null,
        to_room_id: null,
        gate_type: null,
        provisioning_state: "legacy_unconfigured",
        status: "active",
        ...fields,
      };
      const keys = Object.keys(base);
      const params = keys.map((_, i) => `$${i + 1}`);
      await pool.query(
        `insert into vt_rfid_readers (${keys.join(", ")}) values (${params.join(", ")})`,
        keys.map((k) => base[k]),
      );
    }

    async function insertEquipment(clinicId: string): Promise<string> {
      const id = uid();
      await pool.query(
        `insert into vt_equipment (id, clinic_id, name) values ($1, $2, $3)`,
        [id, clinicId, `Eq-${id.slice(0, 6)}`],
      );
      return id;
    }

    async function insertEgress(fields: Record<string, unknown>): Promise<void> {
      const base: Record<string, unknown> = {
        id: uid(),
        clinic_id: null,
        equipment_id: null,
        gate_id: null,
        gateway_code: `gw-${uid().slice(0, 8)}`,
        source_event_id: `src-${uid().slice(0, 8)}`,
        from_room_id: null,
        batch_id: `batch-${uid().slice(0, 8)}`,
        detected_at: new Date().toISOString(),
        ...fields,
      };
      const keys = Object.keys(base);
      const params = keys.map((_, i) => `$${i + 1}`);
      await pool.query(
        `insert into vt_rfid_egress_signals (${keys.join(", ")}) values (${params.join(", ")})`,
        keys.map((k) => base[k]),
      );
    }

    // ================= tenant safety: composite unique (clinic_id, gateway_code) =================
    {
      const { clinicId } = await seedClinic();
      const gw = `gw-dup-${uid().slice(0, 8)}`;
      await insertReader({ clinic_id: clinicId, gateway_code: gw });
      await expectReject(
        () => insertReader({ clinic_id: clinicId, gateway_code: gw }),
        "duplicate (clinic_id, gateway_code) must be rejected",
      );

      // Same gateway_code in a DIFFERENT clinic is allowed (scoped, not global).
      const other = await seedClinic();
      await insertReader({ clinic_id: other.clinicId, gateway_code: gw });
    }

    // ================= tenant safety: cross-clinic FKs rejected =================
    {
      const a = await seedClinic();
      const b = await seedClinic();
      // room_id from another clinic → composite FK (clinic_id, room_id) fails
      await expectReject(
        () =>
          insertReader({
            clinic_id: a.clinicId,
            room_id: b.roomA, // belongs to clinic b
          }),
        "cross-clinic room_id must be rejected by composite FK",
      );
      // from_room_id / to_room_id from another clinic (with gate_type set so the pair is live)
      await expectReject(
        () =>
          insertReader({
            clinic_id: a.clinicId,
            gate_type: "internal",
            room_id: a.roomA,
            from_room_id: a.roomA,
            to_room_id: b.roomB, // cross-clinic
          }),
        "cross-clinic to_room_id must be rejected by composite FK",
      );
    }

    // ================= directional-pair validity — ONLY when gate_type is SET =================
    {
      const { clinicId, roomA, roomB } = await seedClinic();

      // valid internal gate: both endpoints, distinct, room_id ∈ {from,to}
      await insertReader({
        clinic_id: clinicId,
        gate_type: "internal",
        room_id: roomA,
        from_room_id: roomA,
        to_room_id: roomB,
      });

      // self-referential pair rejected
      await expectReject(
        () =>
          insertReader({
            clinic_id: clinicId,
            gate_type: "internal",
            room_id: roomA,
            from_room_id: roomA,
            to_room_id: roomA,
          }),
        "self-referential internal pair must be rejected",
      );

      // half-populated internal pair rejected (one endpoint null)
      await expectReject(
        () =>
          insertReader({
            clinic_id: clinicId,
            gate_type: "internal",
            room_id: roomA,
            from_room_id: roomA,
            to_room_id: null,
          }),
        "half-populated internal pair must be rejected",
      );

      // room_id neither from nor to → membership rejected (clean case: a third real room)
      const roomC = uid();
      await pool.query(
        `insert into vt_rooms (id, clinic_id, name) values ($1, $2, $3)`,
        [roomC, clinicId, `Room-C-${roomC.slice(0, 6)}`],
      );
      await expectReject(
        () =>
          insertReader({
            clinic_id: clinicId,
            gate_type: "internal",
            room_id: roomC, // a valid same-clinic room, but not an endpoint of the gate
            from_room_id: roomA,
            to_room_id: roomB,
          }),
        "internal gate whose room_id is not an endpoint must be rejected",
      );

      // valid boundary gate: exactly one endpoint, room_id = that endpoint, external side NULL
      await insertReader({
        clinic_id: clinicId,
        gate_type: "boundary",
        room_id: roomA,
        from_room_id: roomA,
        to_room_id: null,
      });

      // boundary gate with two non-null endpoints rejected
      await expectReject(
        () =>
          insertReader({
            clinic_id: clinicId,
            gate_type: "boundary",
            room_id: roomA,
            from_room_id: roomA,
            to_room_id: roomB,
          }),
        "boundary gate with two non-null endpoints must be rejected",
      );

      // boundary gate with two null endpoints rejected
      await expectReject(
        () =>
          insertReader({
            clinic_id: clinicId,
            gate_type: "boundary",
            room_id: roomA,
            from_room_id: null,
            to_room_id: null,
          }),
        "boundary gate with two null endpoints must be rejected",
      );

      // dock gate mirrors boundary: valid single-endpoint form
      await insertReader({
        clinic_id: clinicId,
        gate_type: "dock",
        room_id: roomB,
        from_room_id: null,
        to_room_id: roomB,
      });

      // boundary gate whose room_id != the single internal endpoint rejected (membership)
      await expectReject(
        () =>
          insertReader({
            clinic_id: clinicId,
            gate_type: "boundary",
            room_id: roomB,
            from_room_id: roomA,
            to_room_id: null,
          }),
        "boundary gate room_id must equal the single internal endpoint",
      );

      // NULL room_id on a CONFIGURED boundary/dock gate rejected (three-valued-logic guard):
      // room_id = from_room_id yields SQL NULL when room_id IS NULL, so without an explicit
      // room_id IS NOT NULL the CHECK evaluates to NULL and PASSES. A configured gate must
      // carry its mounting room (subspec §R-M1.1a: room_id = the single internal endpoint).
      await expectReject(
        () =>
          insertReader({
            clinic_id: clinicId,
            gate_type: "boundary",
            room_id: null,
            from_room_id: roomA,
            to_room_id: null,
          }),
        "boundary gate with NULL room_id (from_room_id set) must be rejected",
      );
      await expectReject(
        () =>
          insertReader({
            clinic_id: clinicId,
            gate_type: "boundary",
            room_id: null,
            from_room_id: null,
            to_room_id: roomB,
          }),
        "boundary gate with NULL room_id (to_room_id set) must be rejected",
      );
      await expectReject(
        () =>
          insertReader({
            clinic_id: clinicId,
            gate_type: "dock",
            room_id: null,
            from_room_id: roomA,
            to_room_id: null,
          }),
        "dock gate with NULL room_id (from_room_id set) must be rejected",
      );
      await expectReject(
        () =>
          insertReader({
            clinic_id: clinicId,
            gate_type: "dock",
            room_id: null,
            from_room_id: null,
            to_room_id: roomB,
          }),
        "dock gate with NULL room_id (to_room_id set) must be rejected",
      );

      // invalid gate_type value rejected
      await expectReject(
        () =>
          insertReader({
            clinic_id: clinicId,
            gate_type: "elevator",
            room_id: roomA,
            from_room_id: roomA,
            to_room_id: roomB,
          }),
        "unknown gate_type must be rejected",
      );
    }

    // ================= legacy_unconfigured reader is EXEMPT + VALID =================
    {
      const { clinicId, roomA } = await seedClinic();
      // gate_type UNSET, room_id set, both endpoints NULL → no pair/membership rule fires
      await insertReader({
        clinic_id: clinicId,
        gate_type: null,
        provisioning_state: "legacy_unconfigured",
        room_id: roomA,
        from_room_id: null,
        to_room_id: null,
      });
      const check = await pool.query(
        `select provisioning_state, gate_type from vt_rfid_readers
         where clinic_id = $1 and room_id = $2`,
        [clinicId, roomA],
      );
      assert.ok(
        check.rows.some(
          (r: { provisioning_state: string; gate_type: string | null }) =>
            r.provisioning_state === "legacy_unconfigured" && r.gate_type === null,
        ),
        "legacy_unconfigured reader (gate_type UNSET, room_id set, endpoints NULL) must be accepted",
      );
    }

    // ================= ON DELETE composite-FK behavior (PG15+ column-list SET NULL) =================
    {
      // (1) legacy_unconfigured reader: deleting its referenced room nulls ONLY room_id
      //     (column-list SET NULL). The reader SURVIVES and clinic_id stays intact.
      const { clinicId, roomA } = await seedClinic();
      const readerId = uid();
      await insertReader({
        id: readerId,
        clinic_id: clinicId,
        gate_type: null,
        provisioning_state: "legacy_unconfigured",
        room_id: roomA,
        from_room_id: null,
        to_room_id: null,
      });
      await pool.query(`delete from vt_rooms where id = $1 and clinic_id = $2`, [roomA, clinicId]);
      const after = await pool.query(
        `select clinic_id, room_id from vt_rfid_readers where id = $1`,
        [readerId],
      );
      assert.strictEqual(after.rows.length, 1, "legacy_unconfigured reader must survive deletion of its room");
      assert.strictEqual(after.rows[0].room_id, null, "room_id must be SET NULL when its room is deleted");
      assert.strictEqual(
        after.rows[0].clinic_id,
        clinicId,
        "clinic_id must stay intact (column-list SET NULL nulls only room_id, never the NOT NULL clinic_id)",
      );

      // (2) CONFIGURED directional reader is protected by the gate_type CHECK: deleting an endpoint
      //     room would SET NULL that endpoint, which violates the internal-pair CHECK → delete BLOCKED.
      const cfg = await seedClinic();
      const cfgReaderId = uid();
      await insertReader({
        id: cfgReaderId,
        clinic_id: cfg.clinicId,
        gate_type: "internal",
        provisioning_state: "active",
        room_id: cfg.roomA,
        from_room_id: cfg.roomA,
        to_room_id: cfg.roomB,
      });
      await expectReject(
        () =>
          pool.query(`delete from vt_rooms where id = $1 and clinic_id = $2`, [
            cfg.roomA,
            cfg.clinicId,
          ]),
        "deleting an endpoint room of a CONFIGURED internal reader must be blocked by the directional CHECK",
      );
      const stillThere = await pool.query(
        `select from_room_id, to_room_id, room_id from vt_rfid_readers where id = $1`,
        [cfgReaderId],
      );
      assert.strictEqual(stillThere.rows.length, 1, "configured reader survives the blocked delete");
      assert.strictEqual(
        stillThere.rows[0].from_room_id,
        cfg.roomA,
        "configured reader's directional endpoints stay intact after the blocked delete",
      );
    }

    // ================= migration 173: vt_rfid_secret_rotations clinic_id ON DELETE CASCADE =================
    {
      const clinicId = uid();
      clinicIds.push(clinicId);
      await pool.query(`insert into vt_clinics (id) values ($1)`, [clinicId]);
      const rotationId = uid();
      await pool.query(
        `insert into vt_rfid_secret_rotations (clinic_id, id, idempotency_key, grace_expires_at)
         values ($1, $2, $3, now() + interval '1 hour')`,
        [clinicId, rotationId, `idem-${uid().slice(0, 8)}`],
      );
      const before = await pool.query(
        `select 1 from vt_rfid_secret_rotations where clinic_id = $1`,
        [clinicId],
      );
      assert.strictEqual(before.rows.length, 1, "rotation row must exist before clinic delete");
      // A clinic delete cascades its 173 rotation rows (clinic_id ON DELETE CASCADE).
      await pool.query(`delete from vt_clinics where id = $1`, [clinicId]);
      const after = await pool.query(
        `select 1 from vt_rfid_secret_rotations where clinic_id = $1`,
        [clinicId],
      );
      assert.strictEqual(
        after.rows.length,
        0,
        "clinic delete must cascade-delete its 173 rotation rows",
      );
    }

    // ================= migration 175: vt_rfid_egress_signals tenant guards + ON DELETE =================
    // clinic_id ON DELETE RESTRICT (:39); composite FKs (clinic_id,equipment_id) (:59) and
    // (clinic_id,gate_id) (:61) are the in-DB cross-clinic tenant guard, both ON DELETE CASCADE.
    {
      const a = await seedClinic();
      const b = await seedClinic();

      const eqA1 = await insertEquipment(a.clinicId);
      const eqA2 = await insertEquipment(a.clinicId);
      const eqB = await insertEquipment(b.clinicId);

      const gateA1 = uid();
      const gateA2 = uid();
      const gateB = uid();
      // Configured boundary/dock gates in clinic a (the egress-producing gate kinds).
      await insertReader({
        id: gateA1,
        clinic_id: a.clinicId,
        gate_type: "boundary",
        provisioning_state: "active",
        room_id: a.roomA,
        from_room_id: a.roomA,
        to_room_id: null,
      });
      await insertReader({
        id: gateA2,
        clinic_id: a.clinicId,
        gate_type: "dock",
        provisioning_state: "active",
        room_id: a.roomB,
        from_room_id: null,
        to_room_id: a.roomB,
      });
      // A reader in clinic b (any reader satisfies the composite FK target).
      await insertReader({
        id: gateB,
        clinic_id: b.clinicId,
        provisioning_state: "legacy_unconfigured",
        room_id: b.roomA,
      });

      // Cross-clinic equipment_id → composite FK (clinic_id, equipment_id) rejects.
      await expectReject(
        () => insertEgress({ clinic_id: a.clinicId, equipment_id: eqB, gate_id: gateA1 }),
        "cross-clinic equipment_id must be rejected by the composite FK",
      );
      // Cross-clinic gate_id → composite FK (clinic_id, gate_id) rejects.
      await expectReject(
        () => insertEgress({ clinic_id: a.clinicId, equipment_id: eqA1, gate_id: gateB }),
        "cross-clinic gate_id must be rejected by the composite FK",
      );

      // Deleting a gate cascades its egress rows ((clinic_id, gate_id) FK ON DELETE CASCADE).
      const egGate = uid();
      await insertEgress({ id: egGate, clinic_id: a.clinicId, equipment_id: eqA1, gate_id: gateA1 });
      await pool.query(`delete from vt_rfid_readers where id = $1 and clinic_id = $2`, [
        gateA1,
        a.clinicId,
      ]);
      const afterGate = await pool.query(
        `select 1 from vt_rfid_egress_signals where id = $1`,
        [egGate],
      );
      assert.strictEqual(
        afterGate.rows.length,
        0,
        "deleting a gate must cascade-delete its egress rows",
      );

      // Deleting an equipment cascades its egress rows ((clinic_id, equipment_id) FK ON DELETE CASCADE).
      const egEq = uid();
      await insertEgress({ id: egEq, clinic_id: a.clinicId, equipment_id: eqA2, gate_id: gateA2 });
      await pool.query(`delete from vt_equipment where id = $1 and clinic_id = $2`, [
        eqA2,
        a.clinicId,
      ]);
      const afterEq = await pool.query(
        `select 1 from vt_rfid_egress_signals where id = $1`,
        [egEq],
      );
      assert.strictEqual(
        afterEq.rows.length,
        0,
        "deleting an equipment must cascade-delete its egress rows",
      );

      // A clinic delete is BLOCKED by ON DELETE RESTRICT while an egress row exists.
      const egRestrict = uid();
      await insertEgress({ id: egRestrict, clinic_id: b.clinicId, equipment_id: eqB, gate_id: gateB });
      await expectReject(
        () => pool.query(`delete from vt_clinics where id = $1`, [b.clinicId]),
        "clinic delete must be blocked by egress ON DELETE RESTRICT while an egress row exists",
      );
      const survive = await pool.query(
        `select 1 from vt_rfid_egress_signals where id = $1`,
        [egRestrict],
      );
      assert.strictEqual(
        survive.rows.length,
        1,
        "egress row survives the RESTRICT-blocked clinic delete",
      );
    }

    // ================= backfill: rooms.gateway_code → managed reader (registry authoritative) =================
    {
      const clinicId = uid();
      clinicIds.push(clinicId);
      await pool.query(`insert into vt_clinics (id) values ($1)`, [clinicId]);
      const roomId = uid();
      const gatewayCode = `gw-legacy-${uid().slice(0, 8)}`;
      await pool.query(
        `insert into vt_rooms (id, clinic_id, name, gateway_code) values ($1, $2, $3, $4)`,
        [roomId, clinicId, `Legacy-${roomId.slice(0, 6)}`, gatewayCode],
      );

      // Re-run the backfill statement idempotently so this fresh room gets a managed reader.
      // (The migration ran once at deploy; this mirrors its projection for rooms created after.)
      await pool.query(
        `insert into vt_rfid_readers (id, clinic_id, name, gateway_code, room_id, provisioning_state, status, created_at)
         select gen_random_uuid()::text, r.clinic_id, 'Gateway ' || r.gateway_code, r.gateway_code, r.id,
                'legacy_unconfigured', 'active', now()
         from vt_rooms r
         where r.gateway_code is not null
           and r.clinic_id = $1
           and not exists (
             select 1 from vt_rfid_readers rr
             where rr.clinic_id = r.clinic_id and rr.gateway_code = r.gateway_code
           )`,
        [clinicId],
      );

      // Gateway resolution now lives in vt_rfid_readers: (clinic_id, gateway_code) → room_id.
      const resolved = await pool.query(
        `select room_id, provisioning_state, gate_type from vt_rfid_readers
         where clinic_id = $1 and gateway_code = $2`,
        [clinicId, gatewayCode],
      );
      assert.strictEqual(
        resolved.rows.length,
        1,
        "backfill must produce exactly one managed reader per rooms.gateway_code",
      );
      assert.strictEqual(
        resolved.rows[0].room_id,
        roomId,
        "backfilled reader must map the gateway to its room (registry authoritative for ingest resolution)",
      );
      assert.strictEqual(
        resolved.rows[0].provisioning_state,
        "legacy_unconfigured",
        "backfilled reader must be legacy_unconfigured",
      );
      assert.strictEqual(
        resolved.rows[0].gate_type,
        null,
        "backfilled reader must have gate_type UNSET (serves last-seen, not directional egress)",
      );
    }

    console.log("✅ rfid-readers.test.ts passed");
  } finally {
    for (const clinicId of clinicIds) {
      // Egress first: its clinic_id ON DELETE RESTRICT would otherwise block the clinic delete.
      await pool.query(`delete from vt_rfid_egress_signals where clinic_id = $1`, [clinicId]);
      await pool.query(`delete from vt_rfid_secret_rotations where clinic_id = $1`, [clinicId]);
      await pool.query(`delete from vt_rfid_readers where clinic_id = $1`, [clinicId]);
      await pool.query(`delete from vt_equipment where clinic_id = $1`, [clinicId]);
      await pool.query(`delete from vt_rooms where clinic_id = $1`, [clinicId]);
      await pool.query(`delete from vt_clinics where id = $1`, [clinicId]);
    }
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
