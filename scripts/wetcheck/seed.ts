/**
 * Wet-check seed: realistic fixtures for full-flow testing (scan, redocking,
 * waitlist, staging, inventory, shifts, tasks).
 *
 * Route params are UUID-validated (`validateUuid`), so every seeded row uses a
 * recognizable UUID prefix `aec0ffee-` — cleanup.ts removes rows by that
 * prefix. Human-readable name → id mapping is written to
 * scripts/wetcheck/manifest.json for the simulation driver.
 *
 * Idempotent (ON CONFLICT DO NOTHING). Reads DATABASE_URL.
 * Safety: refuses to run when NODE_ENV=production unless FORCE_WETCHECK_SEED=1.
 *
 * Usage:
 *   DATABASE_URL=postgres://.../vettrack_wetcheck tsx scripts/wetcheck/seed.ts
 */
import "dotenv/config";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  db,
  pool,
  clinics,
  users,
  rooms,
  docks,
  assetTypes,
  assetTypeConditions,
  equipment,
  unitConditionStates,
  equipmentWaitlist,
  stagingQueue,
  containers,
  inventoryItems,
  containerItems,
  appointments,
} from "../../server/db.js";

const CLINIC_ID = process.env.DEV_DEFAULT_CLINIC_ID?.trim() || "dev-clinic-default";
const PROTECTED_EMAIL = "danerez5@gmail.com";

/** Deterministic wet-check UUID: aec0ffee-0000-4000-8000-<12-hex counter>. */
function wcid(n: number): string {
  return `aec0ffee-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

const ID = {
  users: {
    dan: wcid(0x9001),
    guy: wcid(0x9002),
    noam: wcid(0x9003),
    omer: wcid(0x9004),
    maya: wcid(0x9005),
    avi: wcid(0x9006),
  },
  rooms: { icu: wcid(0x101), surgery: wcid(0x102), wardA: wcid(0x103), wardB: wcid(0x104) },
  docks: { icu: wcid(0x201), surgery: wcid(0x202), wardA: wcid(0x203), wardB: wcid(0x204) },
  assetTypes: { pump: wcid(0x301), monitor: wcid(0x302), oxygen: wcid(0x303) },
  conditions: {
    pumpBattery: wcid(0x401),
    pumpLine: wcid(0x402),
    monitorLeads: wcid(0x403),
    oxygenFilter: wcid(0x404),
  },
  eq: {
    pump01: wcid(0x1001), pump02: wcid(0x1002), pump03: wcid(0x1003), pump04: wcid(0x1004),
    pump05: wcid(0x1005), pump06: wcid(0x1006), pump07: wcid(0x1007), pump08: wcid(0x1008),
    mon01: wcid(0x1011), mon02: wcid(0x1012), mon03: wcid(0x1013), mon04: wcid(0x1014),
    mon05: wcid(0x1015), mon06: wcid(0x1016),
    oxy01: wcid(0x1021), oxy02: wcid(0x1022), oxy03: wcid(0x1023), oxy04: wcid(0x1024),
    legacy01: wcid(0x1031), legacy02: wcid(0x1032), legacy03: wcid(0x1033), legacy04: wcid(0x1034),
  },
  containers: { icu: wcid(0x4101), surgery: wcid(0x4102) },
  items: { saline: wcid(0x4001), syringe: wcid(0x4002), gauze: wcid(0x4003), catheter: wcid(0x4004) },
  tasks: { t1: wcid(0x5001), t2: wcid(0x5002), t3: wcid(0x5003) },
  waitlist: {
    pump05Beta: wcid(0x3001),
    pump05Noam: wcid(0x3002),
    mon04Guy: wcid(0x3003),
    mon04Dan: wcid(0x3004),
  },
  staging: { mon03Beta: wcid(0x3101), mon03Noam: wcid(0x3102) },
};

const now = new Date();
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
const minutesFromNow = (m: number) => new Date(now.getTime() + m * 60_000);

async function main(): Promise<void> {
  const dbUrl = (process.env.DATABASE_URL || "").trim();
  if (!dbUrl) {
    console.error("[wetcheck-seed] DATABASE_URL is required.");
    process.exit(1);
  }
  if (process.env.NODE_ENV === "production" && process.env.FORCE_WETCHECK_SEED !== "1") {
    console.error("[wetcheck-seed] Refusing to seed in production without FORCE_WETCHECK_SEED=1.");
    process.exit(1);
  }
  console.info(`[wetcheck-seed] target=${dbUrl.replace(/:[^:@/]*@/, ":***@")} clinic=${CLINIC_ID}`);

  await db.insert(clinics).values({ id: CLINIC_ID, timezone: "Asia/Jerusalem" }).onConflictDoNothing();

  // ── Users ─────────────────────────────────────────────────────────────
  const staff = [
    // Dev-bypass actors (normally lazy-created by auth middleware; seeded here
    // because waitlist/staging FKs need them before any request runs).
    { id: "dev-admin-001", email: "admin@vettrack.dev", name: "Dev Admin", role: "admin" },
    { id: "dev-user-alpha", email: "alpha@vettrack.dev", name: "Dev Alpha", role: "technician" },
    { id: "dev-user-beta", email: "beta@vettrack.dev", name: "Dev Beta", role: "technician" },
    { id: ID.users.dan, email: PROTECTED_EMAIL, name: "Dan Erez", role: "admin" },
    { id: ID.users.guy, email: "guy.segev@wetcheck.dev", name: "Guy Segev", role: "senior_technician" },
    { id: ID.users.noam, email: "noam.levi@wetcheck.dev", name: "Noam Levi", role: "technician" },
    { id: ID.users.omer, email: "omer.cohen@wetcheck.dev", name: "Omer Cohen", role: "senior_technician" },
    { id: ID.users.maya, email: "maya.rosen@wetcheck.dev", name: "Maya Rosen", role: "vet" },
    { id: ID.users.avi, email: "avi.katz@wetcheck.dev", name: "Avi Katz", role: "student" },
  ] as const;
  for (const s of staff) {
    await db
      .insert(users)
      .values({
        id: s.id,
        clinicId: CLINIC_ID,
        clerkId: s.id,
        email: s.email,
        name: s.name,
        displayName: s.name,
        role: s.role,
        status: "active",
      })
      .onConflictDoNothing();
  }

  // ── Rooms + docks ─────────────────────────────────────────────────────
  const roomRows = [
    { id: ID.rooms.icu, name: "WC ICU", floor: "1", masterNfcTagId: "wc-nfc-icu", gatewayCode: "WC-GW-ICU" },
    { id: ID.rooms.surgery, name: "WC Surgery", floor: "1", masterNfcTagId: "wc-nfc-surgery", gatewayCode: "WC-GW-SUR" },
    { id: ID.rooms.wardA, name: "WC Ward A", floor: "2", masterNfcTagId: "wc-nfc-ward-a", gatewayCode: "WC-GW-WA" },
    { id: ID.rooms.wardB, name: "WC Ward B", floor: "2", masterNfcTagId: "wc-nfc-ward-b", gatewayCode: "WC-GW-WB" },
  ];
  for (const r of roomRows) {
    await db.insert(rooms).values({ ...r, clinicId: CLINIC_ID }).onConflictDoNothing();
  }
  const dockRows = [
    { id: ID.docks.icu, name: "WC ICU Dock", roomId: ID.rooms.icu },
    { id: ID.docks.surgery, name: "WC Surgery Dock", roomId: ID.rooms.surgery },
    { id: ID.docks.wardA, name: "WC Ward A Dock", roomId: ID.rooms.wardA },
    { id: ID.docks.wardB, name: "WC Ward B Dock", roomId: ID.rooms.wardB },
  ];
  for (const d of dockRows) {
    await db.insert(docks).values({ ...d, clinicId: CLINIC_ID }).onConflictDoNothing();
  }

  // ── Asset types + readiness conditions ────────────────────────────────
  const types = [
    { id: ID.assetTypes.pump, name: "WC Infusion Pump" },
    { id: ID.assetTypes.monitor, name: "WC Vital Monitor" },
    { id: ID.assetTypes.oxygen, name: "WC Oxygen Concentrator" },
  ];
  for (const t of types) {
    await db.insert(assetTypes).values({ ...t, clinicId: CLINIC_ID }).onConflictDoNothing();
  }
  const conditions = [
    { id: ID.conditions.pumpBattery, assetTypeId: ID.assetTypes.pump, conditionName: "Battery charged", verificationMethod: "manual", staleAfterMinutes: 720, displayOrder: 1 },
    { id: ID.conditions.pumpLine, assetTypeId: ID.assetTypes.pump, conditionName: "Line primed", verificationMethod: "manual", staleAfterMinutes: 240, displayOrder: 2 },
    { id: ID.conditions.monitorLeads, assetTypeId: ID.assetTypes.monitor, conditionName: "Leads intact", verificationMethod: "manual", staleAfterMinutes: 1440, displayOrder: 1 },
    { id: ID.conditions.oxygenFilter, assetTypeId: ID.assetTypes.oxygen, conditionName: "Filter clean", verificationMethod: "manual", staleAfterMinutes: 10080, displayOrder: 1 },
  ];
  for (const c of conditions) {
    await db.insert(assetTypeConditions).values({ ...c, clinicId: CLINIC_ID }).onConflictDoNothing();
  }

  // ── Equipment fleet ───────────────────────────────────────────────────
  type EqSpec = {
    id: string;
    name: string;
    assetTypeId?: string;
    custodyState: "docked" | "returned" | "checked_out" | "untracked";
    readinessState?: "ready" | "not_ready" | "unknown";
    usageState?: "available" | "staged" | "in_use" | "emergency_use";
    dockId?: string;
    roomId?: string;
    checkedOutById?: string;
    checkedOutByEmail?: string;
    nfcTagId?: string;
    rfidTagEpc?: string;
    expiryDate?: string;
    deletedAt?: Date;
  };

  const fleet: EqSpec[] = [
    // Infusion pumps
    { id: ID.eq.pump01, name: "WC Pump 01", assetTypeId: ID.assetTypes.pump, custodyState: "docked", readinessState: "ready", usageState: "available", dockId: ID.docks.icu, roomId: ID.rooms.icu, nfcTagId: "wc-nfc-pump-01" },
    { id: ID.eq.pump02, name: "WC Pump 02", assetTypeId: ID.assetTypes.pump, custodyState: "docked", readinessState: "ready", usageState: "available", dockId: ID.docks.icu, roomId: ID.rooms.icu, rfidTagEpc: "WCEPC-PUMP-02" },
    { id: ID.eq.pump03, name: "WC Pump 03", assetTypeId: ID.assetTypes.pump, custodyState: "docked", readinessState: "ready", usageState: "available", dockId: ID.docks.wardA, roomId: ID.rooms.wardA },
    { id: ID.eq.pump04, name: "WC Pump 04", assetTypeId: ID.assetTypes.pump, custodyState: "docked", readinessState: "not_ready", usageState: "available", dockId: ID.docks.wardA, roomId: ID.rooms.wardA },
    { id: ID.eq.pump05, name: "WC Pump 05", assetTypeId: ID.assetTypes.pump, custodyState: "checked_out", readinessState: "unknown", usageState: "in_use", checkedOutById: "dev-user-alpha", checkedOutByEmail: "alpha@vettrack.dev" },
    { id: ID.eq.pump06, name: "WC Pump 06", assetTypeId: ID.assetTypes.pump, custodyState: "checked_out", readinessState: "unknown", usageState: "in_use", checkedOutById: ID.users.noam, checkedOutByEmail: "noam.levi@wetcheck.dev" },
    { id: ID.eq.pump07, name: "WC Pump 07", assetTypeId: ID.assetTypes.pump, custodyState: "returned", readinessState: "unknown", usageState: "available" },
    { id: ID.eq.pump08, name: "WC Pump 08", assetTypeId: ID.assetTypes.pump, custodyState: "untracked", readinessState: "unknown", usageState: "available" },
    // Vital monitors
    { id: ID.eq.mon01, name: "WC Monitor 01", assetTypeId: ID.assetTypes.monitor, custodyState: "docked", readinessState: "ready", usageState: "available", dockId: ID.docks.surgery, roomId: ID.rooms.surgery, nfcTagId: "wc-nfc-mon-01" },
    { id: ID.eq.mon02, name: "WC Monitor 02", assetTypeId: ID.assetTypes.monitor, custodyState: "docked", readinessState: "ready", usageState: "available", dockId: ID.docks.wardB, roomId: ID.rooms.wardB },
    { id: ID.eq.mon03, name: "WC Monitor 03", assetTypeId: ID.assetTypes.monitor, custodyState: "docked", readinessState: "ready", usageState: "staged", dockId: ID.docks.surgery, roomId: ID.rooms.surgery },
    { id: ID.eq.mon04, name: "WC Monitor 04", assetTypeId: ID.assetTypes.monitor, custodyState: "checked_out", readinessState: "unknown", usageState: "in_use", checkedOutById: "dev-user-beta", checkedOutByEmail: "beta@vettrack.dev" },
    { id: ID.eq.mon05, name: "WC Monitor 05", assetTypeId: ID.assetTypes.monitor, custodyState: "returned", readinessState: "unknown", usageState: "available" },
    { id: ID.eq.mon06, name: "WC Monitor 06", assetTypeId: ID.assetTypes.monitor, custodyState: "docked", readinessState: "not_ready", usageState: "available", dockId: ID.docks.wardB, roomId: ID.rooms.wardB },
    // Oxygen concentrators
    { id: ID.eq.oxy01, name: "WC Oxygen 01", assetTypeId: ID.assetTypes.oxygen, custodyState: "docked", readinessState: "ready", usageState: "available", dockId: ID.docks.icu, roomId: ID.rooms.icu },
    { id: ID.eq.oxy02, name: "WC Oxygen 02", assetTypeId: ID.assetTypes.oxygen, custodyState: "docked", readinessState: "ready", usageState: "available", dockId: ID.docks.wardB, roomId: ID.rooms.wardB },
    { id: ID.eq.oxy03, name: "WC Oxygen 03", assetTypeId: ID.assetTypes.oxygen, custodyState: "checked_out", readinessState: "unknown", usageState: "in_use", checkedOutById: ID.users.guy, checkedOutByEmail: "guy.segev@wetcheck.dev", expiryDate: "2026-07-20" },
    { id: ID.eq.oxy04, name: "WC Oxygen 04", assetTypeId: ID.assetTypes.oxygen, custodyState: "returned", readinessState: "unknown", usageState: "available", deletedAt: minutesAgo(60 * 24) },
    // Legacy units without asset type (pre-V1 path)
    { id: ID.eq.legacy01, name: "WC Legacy Doppler", custodyState: "returned", usageState: "available", nfcTagId: "wc-nfc-legacy-01" },
    { id: ID.eq.legacy02, name: "WC Legacy Glucometer", custodyState: "returned", usageState: "available" },
    { id: ID.eq.legacy03, name: "WC Legacy ECG", custodyState: "untracked", usageState: "available", rfidTagEpc: "WCEPC-LEGACY-03" },
    { id: ID.eq.legacy04, name: "WC Legacy Scale", custodyState: "returned", usageState: "available" },
  ];

  for (const e of fleet) {
    await db
      .insert(equipment)
      .values({
        id: e.id,
        clinicId: CLINIC_ID,
        name: e.name,
        status: "ok",
        assetTypeId: e.assetTypeId ?? null,
        custodyState: e.custodyState,
        custodyStateSince: minutesAgo(180),
        readinessState: e.readinessState ?? "unknown",
        readinessStateSince: minutesAgo(180),
        usageState: e.usageState ?? "available",
        usageStateSince: minutesAgo(180),
        dockId: e.dockId ?? null,
        roomId: e.roomId ?? null,
        checkedOutById: e.checkedOutById ?? null,
        checkedOutByEmail: e.checkedOutByEmail ?? null,
        checkedOutAt: e.checkedOutById ? minutesAgo(120) : null,
        nfcTagId: e.nfcTagId ?? null,
        rfidTagEpc: e.rfidTagEpc ?? null,
        expiryDate: e.expiryDate ?? null,
        expectedReturnMinutes: e.checkedOutById ? 60 : null,
        deletedAt: e.deletedAt ?? null,
        lastSeen: minutesAgo(90),
      })
      .onConflictDoNothing();
  }

  // Verified condition states for docked+ready units
  let ucsCounter = 0x2001;
  const verifiedPairs: Array<[string, string]> = [
    [ID.eq.pump01, ID.conditions.pumpBattery],
    [ID.eq.pump01, ID.conditions.pumpLine],
    [ID.eq.pump02, ID.conditions.pumpBattery],
    [ID.eq.pump02, ID.conditions.pumpLine],
    [ID.eq.pump03, ID.conditions.pumpBattery],
    [ID.eq.pump03, ID.conditions.pumpLine],
    [ID.eq.pump04, ID.conditions.pumpBattery], // line NOT primed → not_ready
    [ID.eq.mon01, ID.conditions.monitorLeads],
    [ID.eq.mon02, ID.conditions.monitorLeads],
    [ID.eq.mon03, ID.conditions.monitorLeads],
    [ID.eq.oxy01, ID.conditions.oxygenFilter],
    [ID.eq.oxy02, ID.conditions.oxygenFilter],
  ];
  for (const [eqId, condId] of verifiedPairs) {
    await db
      .insert(unitConditionStates)
      .values({
        id: wcid(ucsCounter++),
        clinicId: CLINIC_ID,
        equipmentId: eqId,
        conditionId: condId,
        verified: true,
        verifiedAt: minutesAgo(30),
        verifiedById: ID.users.guy,
      })
      .onConflictDoNothing();
  }

  // ── Waitlist scenarios ────────────────────────────────────────────────
  // Pump 05 (held by alpha): beta then noam waiting.
  await db.insert(equipmentWaitlist).values({
    id: ID.waitlist.pump05Beta,
    clinicId: CLINIC_ID,
    equipmentId: ID.eq.pump05,
    userId: "dev-user-beta",
    joinedAt: minutesAgo(45),
    status: "waiting",
  }).onConflictDoNothing();
  await db.insert(equipmentWaitlist).values({
    id: ID.waitlist.pump05Noam,
    clinicId: CLINIC_ID,
    equipmentId: ID.eq.pump05,
    userId: ID.users.noam,
    joinedAt: minutesAgo(20),
    status: "waiting",
  }).onConflictDoNothing();
  // Monitor 04 (held by beta): guy holds a notification about to expire, dan waiting.
  await db.insert(equipmentWaitlist).values({
    id: ID.waitlist.mon04Guy,
    clinicId: CLINIC_ID,
    equipmentId: ID.eq.mon04,
    userId: ID.users.guy,
    joinedAt: minutesAgo(90),
    status: "notified",
    notifiedAt: minutesAgo(8),
    reservationExpiresAt: minutesFromNow(2),
  }).onConflictDoNothing();
  await db.insert(equipmentWaitlist).values({
    id: ID.waitlist.mon04Dan,
    clinicId: CLINIC_ID,
    equipmentId: ID.eq.mon04,
    userId: ID.users.dan,
    joinedAt: minutesAgo(60),
    status: "waiting",
  }).onConflictDoNothing();

  // ── Staging queue (Monitor 03 staged) ────────────────────────────────
  await db.insert(stagingQueue).values({
    id: ID.staging.mon03Beta,
    clinicId: CLINIC_ID,
    equipmentId: ID.eq.mon03,
    requestedById: "dev-user-beta",
    clinicalPriority: "urgent",
    stagedAt: minutesAgo(15),
    status: "active",
  }).onConflictDoNothing();
  await db.insert(stagingQueue).values({
    id: ID.staging.mon03Noam,
    clinicId: CLINIC_ID,
    equipmentId: ID.eq.mon03,
    requestedById: ID.users.noam,
    clinicalPriority: "routine",
    stagedAt: minutesAgo(10),
    status: "active",
  }).onConflictDoNothing();

  // ── Inventory ─────────────────────────────────────────────────────────
  const items = [
    { id: ID.items.saline, code: "WC-SAL-500", label: "WC Saline 500ml", itemType: "CONSUMABLE", unit: "bag", parLevel: 40, reorderPoint: 15 },
    { id: ID.items.syringe, code: "WC-SYR-10", label: "WC Syringe 10ml", itemType: "CONSUMABLE", unit: "unit", parLevel: 200, reorderPoint: 80 },
    { id: ID.items.gauze, code: "WC-GAU-01", label: "WC Gauze Roll", itemType: "CONSUMABLE", unit: "roll", parLevel: 100, reorderPoint: 30 },
    { id: ID.items.catheter, code: "WC-CAT-22", label: "WC IV Catheter 22G", itemType: "CONSUMABLE", unit: "unit", parLevel: 120, reorderPoint: 50 },
  ];
  for (const i of items) {
    await db.insert(inventoryItems).values({ ...i, clinicId: CLINIC_ID }).onConflictDoNothing();
  }
  const containerRows = [
    { id: ID.containers.icu, name: "WC ICU Cart", department: "ICU", targetQuantity: 100, currentQuantity: 74, roomId: ID.rooms.icu, nfcTagId: "wc-nfc-cont-icu" },
    { id: ID.containers.surgery, name: "WC Surgery Cart", department: "Surgery", targetQuantity: 80, currentQuantity: 22, roomId: ID.rooms.surgery },
  ];
  for (const c of containerRows) {
    await db.insert(containers).values({ ...c, clinicId: CLINIC_ID }).onConflictDoNothing();
  }
  let ciCounter = 0x4201;
  const containerItemRows = [
    { containerId: ID.containers.icu, itemId: ID.items.saline, quantity: 24 },
    { containerId: ID.containers.icu, itemId: ID.items.syringe, quantity: 50 },
    { containerId: ID.containers.surgery, itemId: ID.items.gauze, quantity: 12 },
    { containerId: ID.containers.surgery, itemId: ID.items.catheter, quantity: 10 },
  ];
  for (const ci of containerItemRows) {
    await db
      .insert(containerItems)
      .values({ id: wcid(ciCounter++), clinicId: CLINIC_ID, ...ci })
      .onConflictDoNothing();
  }

  // ── Tasks (vt_appointments) ───────────────────────────────────────────
  const tasks = [
    { id: ID.tasks.t1, vetId: ID.users.maya, startTime: minutesFromNow(30), endTime: minutesFromNow(60), status: "scheduled", appointmentType: "checkup", notes: "WC morning checkup round", priority: "normal" },
    { id: ID.tasks.t2, vetId: ID.users.maya, startTime: minutesFromNow(120), endTime: minutesFromNow(150), status: "scheduled", appointmentType: "maintenance", notes: "WC pump calibration", priority: "high" },
    { id: ID.tasks.t3, vetId: null, startTime: minutesAgo(60), endTime: minutesAgo(30), status: "completed", appointmentType: "followup", notes: "WC completed follow-up", priority: "normal", completedAt: minutesAgo(30) },
  ];
  for (const t of tasks) {
    await db.insert(appointments).values({ ...t, clinicId: CLINIC_ID, createdBy: ID.users.dan }).onConflictDoNothing();
  }

  // ── Manifest for the simulation driver ────────────────────────────────
  const manifestPath = join(dirname(fileURLToPath(import.meta.url)), "manifest.json");
  writeFileSync(manifestPath, JSON.stringify({ clinicId: CLINIC_ID, generatedAt: now.toISOString(), ids: ID }, null, 2));

  console.info("[wetcheck-seed] Done.");
  console.info(`  users     : ${staff.length} (incl. ${PROTECTED_EMAIL} — protected)`);
  console.info(`  rooms     : ${roomRows.length} · docks: ${dockRows.length}`);
  console.info(`  assetTypes: ${types.length} · conditions: ${conditions.length}`);
  console.info(`  equipment : ${fleet.length} (docked/ready, not_ready, checked_out, returned, untracked, staged, soft-deleted)`);
  console.info(`  waitlist  : 4 rows (incl. notified reservation expiring in ~2min)`);
  console.info(`  staging   : 2 active claims`);
  console.info(`  inventory : ${items.length} items · ${containerRows.length} containers`);
  console.info(`  tasks     : ${tasks.length}`);
  console.info(`  manifest  : ${manifestPath}`);
}

main()
  .catch((err) => {
    console.error("[wetcheck-seed] Failed:", err);
    process.exit(1);
  })
  .finally(() => {
    pool.end().catch(() => {});
  });
