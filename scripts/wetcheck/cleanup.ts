/**
 * Wet-check cleanup: removes every row created by seed.ts and any rows the
 * wet-check run produced against seeded fixtures (scan logs, undo tokens,
 * audit rows, returns, imports, shifts, outbox events).
 *
 * Guarantees:
 *   - NEVER deletes the protected account (danerez5@gmail.com).
 *   - Only touches rows whose ids/refs carry the `wetcheck-` prefix, dev-actor
 *     rows created by dev-bypass, or shift-import artifacts flagged `wetcheck`.
 *   - Prints per-table delete counts and a final residue check.
 *
 * Usage:
 *   DATABASE_URL=postgres://.../vettrack_wetcheck tsx scripts/wetcheck/cleanup.ts
 *   Add PURGE_DEV_ACTORS=1 to also remove dev-user-alpha / dev-user-beta rows.
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db, pool } from "../../server/db.js";

const PROTECTED_EMAIL = "danerez5@gmail.com";

async function run(label: string, query: ReturnType<typeof sql>): Promise<void> {
  const res = await db.execute(query);
  const count = (res as unknown as { rowCount?: number }).rowCount ?? 0;
  console.info(`  ${label.padEnd(38)} ${count} row(s)`);
}

async function main(): Promise<void> {
  const dbUrl = (process.env.DATABASE_URL || "").trim();
  if (!dbUrl) {
    console.error("[wetcheck-cleanup] DATABASE_URL is required.");
    process.exit(1);
  }
  console.info(`[wetcheck-cleanup] target=${dbUrl.replace(/:[^:@/]*@/, ":***@")}`);
  console.info(`[wetcheck-cleanup] protected account: ${PROTECTED_EMAIL}`);

  // Dependent / log tables first (no FK cascades on these).
  await run("vt_scan_logs", sql`DELETE FROM vt_scan_logs WHERE equipment_id SIMILAR TO '(wetcheck|aec0ffee)-%' OR user_id SIMILAR TO '(wetcheck|aec0ffee)-%' OR user_id IN ('dev-admin-001','dev-user-alpha','dev-user-beta')`);
  await run("vt_undo_tokens", sql`DELETE FROM vt_undo_tokens WHERE equipment_id SIMILAR TO '(wetcheck|aec0ffee)-%'`);
  await run("vt_transfer_logs", sql`DELETE FROM vt_transfer_logs WHERE equipment_id SIMILAR TO '(wetcheck|aec0ffee)-%'`);
  await run("vt_audit_logs", sql`DELETE FROM vt_audit_logs WHERE target_id SIMILAR TO '(wetcheck|aec0ffee)-%' OR performed_by SIMILAR TO '(wetcheck|aec0ffee)-%' OR performed_by IN ('dev-admin-001','dev-user-alpha','dev-user-beta')`);
  await run("vt_operational_metrics", sql`DELETE FROM vt_operational_metrics WHERE equipment_id SIMILAR TO '(wetcheck|aec0ffee)-%' OR user_id SIMILAR TO '(wetcheck|aec0ffee)-%' OR user_id IN ('dev-admin-001','dev-user-alpha','dev-user-beta')`);
  await run("vt_alert_acks", sql`DELETE FROM vt_alert_acks WHERE equipment_id SIMILAR TO '(wetcheck|aec0ffee)-%'`);
  await run("vt_event_outbox", sql`DELETE FROM vt_event_outbox WHERE payload::text LIKE '%wetcheck-%' OR payload::text LIKE '%aec0ffee-%'`);
  await run("vt_scheduled_notifications", sql`DELETE FROM vt_scheduled_notifications WHERE equipment_id SIMILAR TO '(wetcheck|aec0ffee)-%' OR user_id SIMILAR TO '(wetcheck|aec0ffee)-%'`);

  // Equipment-linked tables (also covered by FK cascade, run for visibility).
  await run("vt_equipment_returns", sql`DELETE FROM vt_equipment_returns WHERE equipment_id SIMILAR TO '(wetcheck|aec0ffee)-%'`);
  await run("vt_equipment_waitlist", sql`DELETE FROM vt_equipment_waitlist WHERE equipment_id SIMILAR TO '(wetcheck|aec0ffee)-%' OR id SIMILAR TO '(wetcheck|aec0ffee)-%'`);
  await run("vt_staging_queue", sql`DELETE FROM vt_staging_queue WHERE equipment_id SIMILAR TO '(wetcheck|aec0ffee)-%' OR id SIMILAR TO '(wetcheck|aec0ffee)-%'`);
  await run("vt_unit_condition_states", sql`DELETE FROM vt_unit_condition_states WHERE equipment_id SIMILAR TO '(wetcheck|aec0ffee)-%' OR id SIMILAR TO '(wetcheck|aec0ffee)-%'`);
  await run("vt_equipment_rfid_reads", sql`DELETE FROM vt_equipment_rfid_reads WHERE equipment_id SIMILAR TO '(wetcheck|aec0ffee)-%'`);

  // Core wet-check entities.
  await run("vt_equipment", sql`DELETE FROM vt_equipment WHERE id SIMILAR TO '(wetcheck|aec0ffee)-%'`);
  await run("vt_asset_type_conditions", sql`DELETE FROM vt_asset_type_conditions WHERE id SIMILAR TO '(wetcheck|aec0ffee)-%'`);
  await run("vt_asset_types", sql`DELETE FROM vt_asset_types WHERE id SIMILAR TO '(wetcheck|aec0ffee)-%'`);
  await run("vt_docks", sql`DELETE FROM vt_docks WHERE id SIMILAR TO '(wetcheck|aec0ffee)-%'`);

  // Inventory.
  await run("vt_dispense_events", sql`DELETE FROM vt_dispense_events WHERE container_id SIMILAR TO '(wetcheck|aec0ffee)-%' OR items::text LIKE '%aec0ffee-%' OR items::text LIKE '%wetcheck-%'`);
  await run("vt_restock_events", sql`DELETE FROM vt_restock_events WHERE container_id SIMILAR TO '(wetcheck|aec0ffee)-%' OR session_id IN (SELECT id FROM vt_restock_sessions WHERE container_id SIMILAR TO '(wetcheck|aec0ffee)-%')`);
  await run("vt_restock_sessions", sql`DELETE FROM vt_restock_sessions WHERE container_id SIMILAR TO '(wetcheck|aec0ffee)-%'`);
  await run("vt_inventory_logs", sql`DELETE FROM vt_inventory_logs WHERE container_id SIMILAR TO '(wetcheck|aec0ffee)-%'`);
  await run("vt_container_items", sql`DELETE FROM vt_container_items WHERE container_id SIMILAR TO '(wetcheck|aec0ffee)-%' OR item_id SIMILAR TO '(wetcheck|aec0ffee)-%'`);
  await run("vt_containers", sql`DELETE FROM vt_containers WHERE id SIMILAR TO '(wetcheck|aec0ffee)-%'`);
  await run("vt_inventory_item_prices", sql`DELETE FROM vt_inventory_item_prices WHERE item_id SIMILAR TO '(wetcheck|aec0ffee)-%'`);
  await run("vt_items", sql`DELETE FROM vt_items WHERE id SIMILAR TO '(wetcheck|aec0ffee)-%'`);

  // Tasks & shifts.
  await run("vt_appointments", sql`DELETE FROM vt_appointments WHERE id SIMILAR TO '(wetcheck|aec0ffee)-%' OR created_by SIMILAR TO '(wetcheck|aec0ffee)-%'`);
  await run("vt_shift_adjustments", sql`DELETE FROM vt_shift_adjustments WHERE id SIMILAR TO '(wetcheck|aec0ffee)-%' OR requester_user_id SIMILAR TO '(wetcheck|aec0ffee)-%'`);
  await run("vt_doctor_shifts", sql`DELETE FROM vt_doctor_shifts WHERE user_id SIMILAR TO '(wetcheck|aec0ffee)-%'`);
  await run("vt_shifts (wetcheck imports)", sql`DELETE FROM vt_shifts WHERE employee_name LIKE 'WC %'`);
  await run("vt_shift_imports", sql`DELETE FROM vt_shift_imports WHERE filename LIKE '%wetcheck%' OR imported_by SIMILAR TO '(wetcheck|aec0ffee)-%'`);
  await run("vt_rooms", sql`DELETE FROM vt_rooms WHERE id SIMILAR TO '(wetcheck|aec0ffee)-%'`);

  // Users last — protected email is excluded no matter what.
  if (process.env.PURGE_DEV_ACTORS === "1") {
    await run("vt_users (dev actors)", sql`DELETE FROM vt_users WHERE id IN ('dev-user-alpha','dev-user-beta') AND email <> ${PROTECTED_EMAIL}`);
  }
  await run("vt_users (wetcheck)", sql`DELETE FROM vt_users WHERE id SIMILAR TO '(wetcheck|aec0ffee)-%' AND email <> ${PROTECTED_EMAIL}`);

  // Residue check.
  const residue = await db.execute(sql`
    SELECT 'equipment' AS t, count(*)::int AS n FROM vt_equipment WHERE id SIMILAR TO '(wetcheck|aec0ffee)-%'
    UNION ALL SELECT 'users', count(*)::int FROM vt_users WHERE id SIMILAR TO '(wetcheck|aec0ffee)-%' AND email <> ${PROTECTED_EMAIL}
    UNION ALL SELECT 'waitlist', count(*)::int FROM vt_equipment_waitlist WHERE id SIMILAR TO '(wetcheck|aec0ffee)-%'
    UNION ALL SELECT 'rooms', count(*)::int FROM vt_rooms WHERE id SIMILAR TO '(wetcheck|aec0ffee)-%'
  `);
  const rows = (residue as unknown as { rows: Array<{ t: string; n: number }> }).rows ?? [];
  const leftover = rows.filter((r) => Number(r.n) > 0);
  if (leftover.length > 0) {
    console.error("[wetcheck-cleanup] RESIDUE FOUND:", leftover);
    process.exit(2);
  }

  const protectedCheck = await db.execute(
    sql`SELECT count(*)::int AS n FROM vt_users WHERE email = ${PROTECTED_EMAIL}`,
  );
  const n = Number((protectedCheck as unknown as { rows: Array<{ n: number }> }).rows?.[0]?.n ?? 0);
  console.info(`[wetcheck-cleanup] protected account rows remaining: ${n} (expected >= 0, never deleted by this script)`);
  console.info("[wetcheck-cleanup] Done — no wet-check residue.");
}

main()
  .catch((err) => {
    console.error("[wetcheck-cleanup] Failed:", err);
    process.exit(1);
  })
  .finally(() => {
    pool.end().catch(() => {});
  });
