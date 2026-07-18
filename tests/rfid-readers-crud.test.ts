/**
 * R-M1.1b — Managed RFID reader entity CRUD (create / rename / deactivate).
 *
 * Promotes `rfid-readers.service.ts` from a derived read-only list to entity CRUD.
 * DB-integration: needs DATABASE_URL + migration 172 applied. Self-skips when the
 * DB is unreachable (default CI runs without a DB — the assertions gate on `dbReachable`).
 *
 * FROZEN R-M1 guardrails asserted here:
 *   (3) every mutation is clinicId-scoped; a cross-clinic id resolves to null (never mutated).
 *   (b) reader status/health derives from the reader's OWN heartbeat (lastReaderHeartbeatAt),
 *       NOT equipment.lastRfid* asset-read traffic — a healthy-but-quiet reader with recent
 *       heartbeat is "online"; a reader with only an asset read (lastSeenAt) but NO heartbeat
 *       reads "no_signal", never "online".
 *   (1) CRUD never touches custody — asserted by scope (service only writes vt_rfid_readers).
 *
 * Run: DATABASE_URL=... pnpm test -- tests/rfid-readers-crud.test.ts
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { randomUUID } from "crypto";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
let probePool: Pool | null = null;
let dbReachable = false;

if (DATABASE_URL) {
  probePool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2500, max: 2 });
  try {
    await probePool.query("SELECT 1");
    const { rows } = await probePool.query<{ t: string | null }>(
      "SELECT to_regclass('public.vt_rfid_readers') AS t",
    );
    dbReachable = rows[0]?.t === "vt_rfid_readers";
  } catch {
    dbReachable = false;
  }
}

const {
  createRfidReader,
  renameRfidReader,
  deactivateRfidReader,
  listManagedRfidReaders,
} = await import("../server/services/rfid-readers.service.js");

const uid = () => randomUUID();

// Two isolated tenants created per-run so assertions never collide with seed data.
const clinicA = `test-clinic-a-${uid()}`;
const clinicB = `test-clinic-b-${uid()}`;
const roomA = uid();

async function seed(pool: Pool) {
  await pool.query("INSERT INTO vt_clinics (id) VALUES ($1), ($2)", [clinicA, clinicB]);
  await pool.query("INSERT INTO vt_rooms (id, name, clinic_id) VALUES ($1, $2, $3)", [
    roomA,
    "ICU",
    clinicA,
  ]);
}

async function cleanup(pool: Pool) {
  await pool.query("DELETE FROM vt_rfid_readers WHERE clinic_id = ANY($1)", [[clinicA, clinicB]]);
  await pool.query("DELETE FROM vt_rooms WHERE clinic_id = ANY($1)", [[clinicA, clinicB]]);
  await pool.query("DELETE FROM vt_clinics WHERE id = ANY($1)", [[clinicA, clinicB]]);
}

beforeAll(async () => {
  if (dbReachable && probePool) {
    await cleanup(probePool);
    await seed(probePool);
  }
});

afterAll(async () => {
  if (probePool) {
    if (dbReachable) await cleanup(probePool);
    await probePool.end();
  }
});

describe.skipIf(!dbReachable)("rfid-readers.service CRUD (R-M1.1b)", () => {
  it("create inserts a clinic-scoped managed reader", async () => {
    const row = await createRfidReader(clinicA, {
      name: "ICU Doorway",
      gatewayCode: "GW-ICU-01",
      roomId: roomA,
    });
    expect(row.clinicId).toBe(clinicA);
    expect(row.name).toBe("ICU Doorway");
    expect(row.gatewayCode).toBe("GW-ICU-01");
    expect(row.roomId).toBe(roomA);
    expect(row.status).toBe("active");
    // net-new reader has no gate_type yet → exempt from directional rules
    expect(row.gateType).toBeNull();

    const persisted = await probePool!.query(
      "SELECT clinic_id, name, status FROM vt_rfid_readers WHERE id = $1",
      [row.id],
    );
    expect(persisted.rows[0].clinic_id).toBe(clinicA);
    expect(persisted.rows[0].status).toBe("active");
  });

  it("rename updates the name, scoped to clinic", async () => {
    const created = await createRfidReader(clinicA, { name: "Old Name", gatewayCode: "GW-REN-01" });
    const renamed = await renameRfidReader(clinicA, created.id, "New Name");
    expect(renamed).not.toBeNull();
    expect(renamed!.id).toBe(created.id);
    expect(renamed!.name).toBe("New Name");
  });

  it("deactivate flips status to inactive, scoped to clinic", async () => {
    const created = await createRfidReader(clinicA, { name: "To Deactivate", gatewayCode: "GW-DEA-01" });
    const deactivated = await deactivateRfidReader(clinicA, created.id);
    expect(deactivated).not.toBeNull();
    expect(deactivated!.status).toBe("inactive");
  });

  it("rename with a cross-clinic id is denied (returns null, row untouched)", async () => {
    const created = await createRfidReader(clinicA, { name: "Tenant A", gatewayCode: "GW-XC-01" });
    const result = await renameRfidReader(clinicB, created.id, "Hijacked");
    expect(result).toBeNull();

    const untouched = await probePool!.query("SELECT name FROM vt_rfid_readers WHERE id = $1", [
      created.id,
    ]);
    expect(untouched.rows[0].name).toBe("Tenant A");
  });

  it("deactivate with a cross-clinic id is denied (returns null, row still active)", async () => {
    const created = await createRfidReader(clinicA, { name: "Tenant A2", gatewayCode: "GW-XC-02" });
    const result = await deactivateRfidReader(clinicB, created.id);
    expect(result).toBeNull();

    const untouched = await probePool!.query("SELECT status FROM vt_rfid_readers WHERE id = $1", [
      created.id,
    ]);
    expect(untouched.rows[0].status).toBe("active");
  });

  it("list is clinic-scoped — never returns another tenant's readers", async () => {
    await createRfidReader(clinicA, { name: "A-list", gatewayCode: "GW-LA-01" });
    await createRfidReader(clinicB, { name: "B-list", gatewayCode: "GW-LB-01" });

    const listA = await listManagedRfidReaders(clinicA);
    expect(listA.every((r) => r.clinicId === clinicA)).toBe(true);
    expect(listA.some((r) => r.gatewayCode === "GW-LA-01")).toBe(true);
    expect(listA.some((r) => r.gatewayCode === "GW-LB-01")).toBe(false);
  });

  it("health derives from the reader's OWN heartbeat, not asset-read traffic", async () => {
    const now = Date.now();
    const beat = await createRfidReader(clinicA, { name: "Beating", gatewayCode: "GW-HB-01" });
    // reader-level heartbeat within the window
    await probePool!.query("UPDATE vt_rfid_readers SET last_reader_heartbeat_at = now() WHERE id = $1", [
      beat.id,
    ]);

    // A reader with ONLY an asset read (lastSeenAt) but NO heartbeat must NOT read "online".
    const quiet = await createRfidReader(clinicA, { name: "Quiet", gatewayCode: "GW-HB-02" });
    await probePool!.query(
      "UPDATE vt_rfid_readers SET last_seen_at = now(), last_reader_heartbeat_at = NULL WHERE id = $1",
      [quiet.id],
    );

    const list = await listManagedRfidReaders(clinicA, now);
    const beatRow = list.find((r) => r.id === beat.id)!;
    const quietRow = list.find((r) => r.id === quiet.id)!;
    expect(beatRow.health).toBe("online");
    expect(quietRow.health).toBe("no_signal");
  });
});
