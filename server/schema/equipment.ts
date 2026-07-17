import { sql } from "drizzle-orm";
import {
  text, timestamp, boolean, varchar, integer, date,
  index, uniqueIndex, primaryKey, pgEnum, bigint, jsonb,
  unique, foreignKey, check,
} from "drizzle-orm/pg-core";
import { vtTable } from "./helpers.js";
import { clinics, users } from "./core.js";
import { appointments } from "./tasks.js";

export const occupancySourceEnum = pgEnum("vt_occupancy_source", ["manual"]);

export const folders = vtTable("vt_folders", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  type: varchar("type", { length: 20 }).notNull().default("manual"),
  color: text("color"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  deletedBy: text("deleted_by"),
}, (t) => ({
  clinicIdx: index("idx_vt_folders_clinic").on(t.clinicId),
}));

export const rooms = vtTable(
  "vt_rooms",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    floor: text("floor"),
    masterNfcTagId: text("master_nfc_tag_id").unique(),
    gatewayCode: text("gateway_code"),
    syncStatus: varchar("sync_status", { length: 20 }).notNull().default("stale"),
    lastAuditAt: timestamp("last_audit_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    clinicNameUnique: uniqueIndex("vt_rooms_clinic_name_unique").on(table.clinicId, table.name),
    clinicGatewayLookup: index("vt_rooms_clinic_gateway_code_idx").on(table.clinicId, table.gatewayCode),
    clinicGatewayUnique: uniqueIndex("vt_rooms_clinic_gateway_code_uq")
      .on(table.clinicId, table.gatewayCode)
      .where(sql`${table.gatewayCode} IS NOT NULL`),
    // Composite-FK target for vt_rfid_readers(clinic_id, room_id|from_room_id|to_room_id)
    // → enforces same-clinic room references at the DB boundary (R-M1.1a).
    clinicIdUnique: unique("vt_rooms_clinic_id_uq").on(table.clinicId, table.id),
  }),
);

export const docks = vtTable(
  "vt_docks",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description"),
    roomId: text("room_id").references(() => rooms.id, { onDelete: "set null" }),
    assetTypeId: text("asset_type_id").references(() => assetTypes.id, { onDelete: "set null" }),
    capacity: integer("capacity"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    clinicNameUnique: uniqueIndex("vt_docks_clinic_name_unique").on(t.clinicId, t.name),
    clinicRoomAssetTypeUnique: uniqueIndex("vt_docks_clinic_room_assettype_uq")
      .on(t.clinicId, t.roomId, t.assetTypeId)
      .where(sql`${t.assetTypeId} IS NOT NULL`),
  }),
);
export type Dock = typeof docks.$inferSelect;
export type NewDock = typeof docks.$inferInsert;

export const assetTypes = vtTable(
  "vt_asset_types",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    clinicNameUnique: uniqueIndex("vt_asset_types_clinic_name_unique").on(t.clinicId, t.name),
  }),
);
export type AssetType = typeof assetTypes.$inferSelect;
export type NewAssetType = typeof assetTypes.$inferInsert;

export const assetTypeConditions = vtTable(
  "vt_asset_type_conditions",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    assetTypeId: text("asset_type_id").notNull().references(() => assetTypes.id, { onDelete: "cascade" }),
    conditionName: text("condition_name").notNull(),
    verificationMethod: text("verification_method").notNull(),
    staleAfterMinutes: integer("stale_after_minutes").notNull(),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    assetTypeConditionUnique: uniqueIndex("vt_asset_type_conditions_unique").on(
      t.assetTypeId,
      t.conditionName,
    ),
  }),
);
export type AssetTypeCondition = typeof assetTypeConditions.$inferSelect;
export type NewAssetTypeCondition = typeof assetTypeConditions.$inferInsert;

export const equipment = vtTable("vt_equipment", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  nameHe: text("name_he"),
  serialNumber: text("serial_number"),
  model: text("model"),
  manufacturer: text("manufacturer"),
  purchaseDate: text("purchase_date"),
  expiryDate: date("expiry_date", { mode: "string" }),
  expiryNotifiedAt: timestamp("expiry_notified_at"),
  location: text("location"),
  folderId: text("folder_id").references(() => folders.id, { onDelete: "set null" }),
  roomId: text("room_id").references(() => rooms.id, { onDelete: "set null" }),
  status: varchar("status", { length: 20 }).notNull().default("ok"),
  /** Additive damage-tracking status (R-EQ-F3); "ok" preserves existing rows as not-damaged.
   * TEXT + DB-level CHECK (migrations/162_vt_damage_events.sql) rather than VARCHAR(n): resizing a
   * varchar bound later takes an ACCESS EXCLUSIVE lock on this production clinical table. */
  conditionStatus: text("condition_status").notNull().default("ok"),
  lastSeen: timestamp("last_seen"),
  lastStatus: varchar("last_status", { length: 20 }),
  lastMaintenanceDate: timestamp("last_maintenance_date"),
  lastSterilizationDate: timestamp("last_sterilization_date"),
  maintenanceIntervalDays: integer("maintenance_interval_days"),
  imageUrl: text("image_url"),
  nfcTagId: text("nfc_tag_id").unique(),
  rfidTagEpc: text("rfid_tag_epc"),
  lastRfidSeenAt: timestamp("last_rfid_seen_at", { withTimezone: true }),
  lastRfidRoomId: text("last_rfid_room_id").references(() => rooms.id, { onDelete: "set null" }),
  lastRfidGatewayCode: text("last_rfid_gateway_code"),
  lastVerifiedAt: timestamp("last_verified_at"),
  lastVerifiedById: text("last_verified_by_id"),
  // Checkout / ownership
  checkedOutById: text("checked_out_by_id"),
  checkedOutByEmail: text("checked_out_by_email"),
  checkedOutAt: timestamp("checked_out_at"),
  checkedOutLocation: text("checked_out_location"),
  expectedReturnMinutes: integer("expected_return_minutes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  version: integer("version").notNull().default(1),
  deletedAt: timestamp("deleted_at"),
  deletedBy: text("deleted_by"),
  usuallyFoundHere: text("usually_found_here"),
  homeRoomId: text("home_room_id").references(() => rooms.id, { onDelete: "set null" }),
  searchAlias: text("search_alias"),
  staffNote: text("staff_note"),
  // Operational state — V1
  assetTypeId: text("asset_type_id").references(() => assetTypes.id, { onDelete: "set null" }),
  dockId: text("dock_id").references(() => docks.id, { onDelete: "set null" }),
  dockConfirmedReadyAt: timestamp("dock_confirmed_ready_at"),
  dockConfirmedById: text("dock_confirmed_by_id").references(() => users.id, { onDelete: "set null" }),
  custodyState: text("custody_state").notNull().default("untracked"),
  custodyStateSince: timestamp("custody_state_since"),
  untrackedDepartureAt: timestamp("untracked_departure_at"),
  emergencyOverrideAt: timestamp("emergency_override_at"),
  emergencyOverrideById: text("emergency_override_by_id").references(() => users.id, { onDelete: "set null" }),
  readinessState: text("readiness_state").notNull().default("unknown"),
  readinessStateSince: timestamp("readiness_state_since"),
  usageState: text("usage_state").notNull().default("available"),
  usageStateSince: timestamp("usage_state_since"),
  /**
   * R-CBF-1.2 — Code Blue soft-reserve. Nullable ADVISORY hint that a crash-cart
   * unit is the nearest-ready cart reserved for an active Code Blue session. It
   * NEVER blocks a clinician grabbing a different cart and does not participate in
   * custody-toggle semantics. Deliberately a plain nullable text column (NOT a FK
   * to vt_code_blue_sessions): a hard FK would create an equipment.ts↔er.ts import
   * cycle and could null/cascade in ways that fight "advisory, never blocks"
   * (end is server-confirmed only — a committed session is never deleted). Set via
   * compare-and-set (write only where NULL) and cleared scoped by session id in
   * server/lib/code-blue-soft-reserve.ts.
   */
  reservedForSessionId: text("reserved_for_session_id"),
}, (table) => ({
  clinicRfidTagLookup: index("vt_equipment_clinic_rfid_tag_epc_idx").on(table.clinicId, table.rfidTagEpc),
  clinicRfidTagUnique: uniqueIndex("vt_equipment_clinic_rfid_tag_epc_uq")
    .on(table.clinicId, table.rfidTagEpc)
    .where(sql`${table.rfidTagEpc} IS NOT NULL`),
}));

export const equipmentRfidReads = vtTable(
  "vt_equipment_rfid_reads",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    equipmentId: text("equipment_id").notNull().references(() => equipment.id, { onDelete: "cascade" }),
    fromRoomId: text("from_room_id").references(() => rooms.id, { onDelete: "set null" }),
    toRoomId: text("to_room_id").notNull().references(() => rooms.id, { onDelete: "restrict" }),
    gatewayCode: text("gateway_code").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }).notNull(),
    batchId: text("batch_id").notNull(),
  },
  (t) => ({
    clinicEquipmentReadAtIdx: index("vt_equipment_rfid_reads_clinic_equipment_read_at_idx").on(
      t.clinicId,
      t.equipmentId,
      t.readAt,
    ),
    clinicReadAtIdx: index("vt_equipment_rfid_reads_clinic_read_at_idx").on(t.clinicId, t.readAt),
  }),
);
export type EquipmentRfidRead = typeof equipmentRfidReads.$inferSelect;
export type NewEquipmentRfidRead = typeof equipmentRfidReads.$inferInsert;

/**
 * R-M1.1a — Managed RFID reader entity. Promotes "reader" from an inferred derived-list
 * (rooms.gateway_code) to a first-class, directional, tenant-safe managed entity.
 *
 * Tenant safety is enforced IN THE DB (not merely in service queries): composite
 * UNIQUE (clinic_id, gateway_code) is the authoritative gateway↔reader registry, and the three
 * composite FKs (clinic_id, room_id|from_room_id|to_room_id) → vt_rooms(clinic_id, id) guarantee
 * every non-null room endpoint is same-clinic. Directional-pair validity + roomId membership fire
 * ONLY when gate_type is SET; a legacy_unconfigured reader (gate_type UNSET) is exempt. RFID is
 * advisory-only and vendor-neutral (ADR-006) — this entity never mutates custody.
 *
 * NOTE: the migration (172_vt_rfid_readers.sql) is the source of truth. The room FKs use PG15+
 * column-list `ON DELETE SET NULL (<room column>)` which drizzle-kit cannot express; drizzle-kit
 * generate is non-functional in this repo, so the `.onDelete("set null")` below is a best-effort
 * approximation for query typing only — never round-tripped to SQL.
 */
export const rfidReaders = vtTable(
  "vt_rfid_readers",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    gatewayCode: text("gateway_code").notNull(),
    /** Canonical physical mounting room (where the device sits). */
    roomId: text("room_id"),
    /** Directional adjacency endpoints (external zone = NULL); routing keys off gateType. */
    fromRoomId: text("from_room_id"),
    toRoomId: text("to_room_id"),
    /** Typed boundary classification the egress rule keys on. UNSET => legacy_unconfigured. */
    gateType: text("gate_type"),
    physicalLocation: text("physical_location"),
    status: text("status").notNull().default("active"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    lastReaderHeartbeatAt: timestamp("last_reader_heartbeat_at", { withTimezone: true }),
    /**
     * R-M1.1d — persisted health state for the reader-offline sweep's dedup. Derived from
     * lastReaderHeartbeatAt (never asset traffic); 'healthy' | 'offline' | 'unknown'. Only
     * healthy<->offline transitions emit a signal. Migration 174 is the source of truth.
     */
    readerHealthStatus: text("reader_health_status").notNull().default("unknown"),
    readerHealthChangedAt: timestamp("reader_health_changed_at", { withTimezone: true }),
    provisioningState: text("provisioning_state").notNull().default("legacy_unconfigured"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    clinicGatewayUnique: unique("vt_rfid_readers_clinic_gateway_uq").on(t.clinicId, t.gatewayCode),
    clinicRoomIdx: index("vt_rfid_readers_clinic_room_idx").on(t.clinicId, t.roomId),
    roomFk: foreignKey({
      columns: [t.clinicId, t.roomId],
      foreignColumns: [rooms.clinicId, rooms.id],
      name: "vt_rfid_readers_room_fk",
    }).onDelete("set null"),
    fromRoomFk: foreignKey({
      columns: [t.clinicId, t.fromRoomId],
      foreignColumns: [rooms.clinicId, rooms.id],
      name: "vt_rfid_readers_from_room_fk",
    }).onDelete("set null"),
    toRoomFk: foreignKey({
      columns: [t.clinicId, t.toRoomId],
      foreignColumns: [rooms.clinicId, rooms.id],
      name: "vt_rfid_readers_to_room_fk",
    }).onDelete("set null"),
    gateTypeCheck: check(
      "vt_rfid_readers_gate_type_ck",
      sql`${t.gateType} IS NULL OR ${t.gateType} IN ('internal', 'boundary', 'dock')`,
    ),
    directionalCheck: check(
      "vt_rfid_readers_directional_ck",
      sql`${t.gateType} IS NULL
        OR (
          ${t.gateType} = 'internal'
          AND ${t.fromRoomId} IS NOT NULL
          AND ${t.toRoomId} IS NOT NULL
          AND ${t.fromRoomId} <> ${t.toRoomId}
          AND ${t.roomId} IS NOT NULL
          AND (${t.roomId} = ${t.fromRoomId} OR ${t.roomId} = ${t.toRoomId})
        )
        OR (
          ${t.gateType} IN ('boundary', 'dock')
          AND (
            (${t.roomId} IS NOT NULL AND ${t.fromRoomId} IS NOT NULL AND ${t.toRoomId} IS NULL AND ${t.roomId} = ${t.fromRoomId})
            OR (${t.roomId} IS NOT NULL AND ${t.fromRoomId} IS NULL AND ${t.toRoomId} IS NOT NULL AND ${t.roomId} = ${t.toRoomId})
          )
        )`,
    ),
  }),
);
export type RfidReader = typeof rfidReaders.$inferSelect;
export type NewRfidReader = typeof rfidReaders.$inferInsert;

/**
 * R-M1.2c — idempotent `possible_egress` signal store.
 *
 * A directional boundary/dock exit toward the external (NULL) endpoint with no matching prior
 * entry emits EXACTLY ONE bounded-enum signal. Idempotency is enforced IN THE DB via the
 * composite UNIQUE correlation key (clinic_id, equipment_id, gate_id, source_event_id) —
 * source_event_id is a deterministic fingerprint of the intrinsic read (equipment + gateway +
 * readAt + direction), so retries and out-of-order batches dedupe. Composite FKs pin equipment
 * + gate same-clinic. Advisory-only (ADR-006): never mutates custody. Migration 175 is the
 * source of truth (composite FKs drizzle-kit can't express); this def is for query typing only.
 */
export const rfidEgressSignals = vtTable(
  "vt_rfid_egress_signals",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    equipmentId: text("equipment_id").notNull(),
    /** the gate (reader) the exit was detected through */
    gateId: text("gate_id").notNull(),
    gatewayCode: text("gateway_code").notNull(),
    /** deterministic fingerprint of the intrinsic read (dedup key component) */
    sourceEventId: text("source_event_id").notNull(),
    /** internal room the asset exited FROM (the boundary/dock gate's non-null endpoint) */
    fromRoomId: text("from_room_id"),
    /** batch that produced this signal (diagnostic only; NOT part of the correlation key) */
    batchId: text("batch_id").notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    correlationUnique: unique("vt_rfid_egress_signals_correlation_uq").on(
      t.clinicId,
      t.equipmentId,
      t.gateId,
      t.sourceEventId,
    ),
    clinicEquipmentDetectedIdx: index(
      "vt_rfid_egress_signals_clinic_equipment_detected_idx",
    ).on(t.clinicId, t.equipmentId, t.detectedAt),
    equipmentFk: foreignKey({
      columns: [t.clinicId, t.equipmentId],
      foreignColumns: [equipment.clinicId, equipment.id],
      name: "vt_rfid_egress_signals_equipment_fk",
    }).onDelete("cascade"),
    gateFk: foreignKey({
      columns: [t.clinicId, t.gateId],
      foreignColumns: [rfidReaders.clinicId, rfidReaders.id],
      name: "vt_rfid_egress_signals_gate_fk",
    }).onDelete("cascade"),
  }),
);
export type RfidEgressSignal = typeof rfidEgressSignals.$inferSelect;
export type NewRfidEgressSignal = typeof rfidEgressSignals.$inferInsert;

/**
 * R-M1.1c — durable state for the per-clinic RFID HMAC secret-rotation contract.
 *
 * The plaintext secrets live ONLY in the encrypted credential blob (credential-manager,
 * adapter "rfid"). This table stores rotation STATE — never the plaintext — so a same-key
 * retry replays the original envelope without re-issuing/re-delivering a secret. The partial
 * unique index (clinic_id) WHERE previous_retained enforces at-most-one in-flight rotation per
 * clinic (concurrency winner). NOTE: migration 173 is the source of truth (partial index +
 * JSONB defaults drizzle-kit can't express); this def is for query typing only.
 */
export const rfidSecretRotations = vtTable(
  "vt_rfid_secret_rotations",
  {
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    /** grace | completed | rolled_back */
    status: text("status").notNull().default("grace"),
    rotationStartedAt: timestamp("rotation_started_at", { withTimezone: true }).notNull().defaultNow(),
    graceExpiresAt: timestamp("grace_expires_at", { withTimezone: true }).notNull(),
    /** vt_rfid_readers.id[] eligible + active at rotation start. */
    snapshotReaderIds: jsonb("snapshot_reader_ids").$type<string[]>().notNull().default([]),
    ackedReaderIds: jsonb("acked_reader_ids").$type<string[]>().notNull().default([]),
    previousRetained: boolean("previous_retained").notNull().default(true),
    secretDelivered: boolean("secret_delivered").notNull().default(true),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.clinicId, t.idempotencyKey] }),
    clinicIdUnique: unique("vt_rfid_secret_rotations_clinic_id_uq").on(t.clinicId, t.id),
  }),
);
export type RfidSecretRotation = typeof rfidSecretRotations.$inferSelect;
export type NewRfidSecretRotation = typeof rfidSecretRotations.$inferInsert;

export const unitConditionStates = vtTable(
  "vt_unit_condition_states",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    equipmentId: text("equipment_id").notNull().references(() => equipment.id, { onDelete: "cascade" }),
    conditionId: text("condition_id").notNull().references(() => assetTypeConditions.id, { onDelete: "cascade" }),
    verified: boolean("verified").notNull().default(false),
    verifiedAt: timestamp("verified_at"),
    verifiedById: text("verified_by_id").references(() => users.id, { onDelete: "set null" }),
    notes: text("notes"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    equipmentConditionUnique: uniqueIndex("vt_unit_condition_states_unique").on(
      t.equipmentId,
      t.conditionId,
    ),
    clinicEquipmentIdx: index("vt_unit_condition_states_clinic_equipment").on(
      t.clinicId,
      t.equipmentId,
    ),
  }),
);
export type UnitConditionState = typeof unitConditionStates.$inferSelect;
export type NewUnitConditionState = typeof unitConditionStates.$inferInsert;

export const equipmentReturns = vtTable("vt_equipment_returns", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  equipmentId: text("equipment_id").notNull().references(() => equipment.id, { onDelete: "cascade" }),
  returnedById: text("returned_by_id").notNull(),
  returnedByEmail: text("returned_by_email").notNull(),
  returnedAt: timestamp("returned_at").defaultNow().notNull(),
  isPluggedIn: boolean("is_plugged_in").notNull().default(false),
  plugInDeadlineMinutes: integer("plug_in_deadline_minutes").notNull().default(30),
  plugInAlertSentAt: timestamp("plug_in_alert_sent_at"),
  chargeAlertJobId: text("charge_alert_job_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  clinicEquipmentIdx: index("idx_vt_equipment_returns_clinic_equipment").on(t.clinicId, t.equipmentId),
}));

/** Append-only "this item is at its station" assertion stream (docking P2, design §3.3/§4). Never expires by time — only by contradiction (D-13). Current anchor = latest row per equipment with invalidatedAt IS NULL. */
export const equipmentAnchors = vtTable(
  "vt_equipment_anchors",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    equipmentId: text("equipment_id").notNull().references(() => equipment.id, { onDelete: "cascade" }),
    dockId: text("dock_id").references(() => docks.id, { onDelete: "set null" }),
    roomId: text("room_id").references(() => rooms.id, { onDelete: "set null" }),
    assertedById: text("asserted_by_id"),
    assertedAt: timestamp("asserted_at", { withTimezone: true }).notNull().defaultNow(),
    source: text("source").notNull(),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    invalidatedReason: text("invalidated_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    clinicEquipmentAssertedIdx: index("idx_vt_equipment_anchors_clinic_equipment_asserted").on(t.clinicId, t.equipmentId, t.assertedAt),
    currentIdx: uniqueIndex("idx_vt_equipment_anchors_current").on(t.clinicId, t.equipmentId).where(sql`${t.invalidatedAt} IS NULL`),
  }),
);
export type EquipmentAnchor = typeof equipmentAnchors.$inferSelect;
export type NewEquipmentAnchor = typeof equipmentAnchors.$inferInsert;

export const stagingQueue = vtTable(
  "vt_staging_queue",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    equipmentId: text("equipment_id").notNull().references(() => equipment.id, { onDelete: "cascade" }),
    requestedById: text("requested_by_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    taskId: text("task_id").references(() => appointments.id, { onDelete: "set null" }),
    clinicalPriority: text("clinical_priority").notNull().default("routine"),
    stagedAt: timestamp("staged_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at"),
    status: text("status").notNull().default("active"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    clinicEquipmentIdx: index("vt_staging_queue_clinic_equipment").on(
      t.clinicId,
      t.equipmentId,
      t.status,
    ),
    expiryIdx: index("vt_staging_queue_expiry")
      .on(t.expiresAt)
      .where(sql`${t.status} = 'active' AND ${t.expiresAt} IS NOT NULL`),
  }),
);
export type StagingQueueRow = typeof stagingQueue.$inferSelect;
export type NewStagingQueueRow = typeof stagingQueue.$inferInsert;

/** Per-device queue while another technician holds checkout custody (Phase B — not dock staging). */
export const equipmentWaitlist = vtTable(
  "vt_equipment_waitlist",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    equipmentId: text("equipment_id").notNull().references(() => equipment.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at").defaultNow().notNull(),
    priority: integer("priority").notNull().default(0),
    status: text("status").notNull().default("waiting"),
    reservationExpiresAt: timestamp("reservation_expires_at"),
    notifiedAt: timestamp("notified_at"),
    fulfilledAt: timestamp("fulfilled_at"),
    cancelledAt: timestamp("cancelled_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    clinicEquipmentIdx: index("vt_equipment_waitlist_clinic_equipment").on(
      t.clinicId,
      t.equipmentId,
      t.status,
    ),
    userActiveUnique: uniqueIndex("vt_equipment_waitlist_user_active_uq")
      .on(t.equipmentId, t.userId)
      .where(sql`${t.status} IN ('waiting', 'notified')`),
    oneNotifiedUnique: uniqueIndex("vt_equipment_waitlist_one_notified_uq")
      .on(t.equipmentId)
      .where(sql`${t.status} = 'notified'`),
    reservationExpiryIdx: index("vt_equipment_waitlist_reservation_expiry")
      .on(t.reservationExpiresAt)
      .where(sql`${t.status} = 'notified' AND ${t.reservationExpiresAt} IS NOT NULL`),
  }),
);
export type EquipmentWaitlistRow = typeof equipmentWaitlist.$inferSelect;
export type NewEquipmentWaitlistRow = typeof equipmentWaitlist.$inferInsert;

export const operationalMetrics = vtTable(
  "vt_operational_metrics",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    equipmentId: text("equipment_id").references(() => equipment.id, { onDelete: "set null" }),
    roomId: text("room_id").references(() => rooms.id, { onDelete: "set null" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    durationMs: bigint("duration_ms", { mode: "number" }),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    eventIdx: index("vt_operational_metrics_event_idx").on(t.clinicId, t.eventType, t.createdAt),
    equipmentIdx: index("vt_operational_metrics_equipment_idx").on(t.equipmentId, t.createdAt),
    roomIdx: index("vt_operational_metrics_room_idx").on(t.roomId, t.createdAt),
  }),
);
export type OperationalMetric = typeof operationalMetrics.$inferSelect;
export type NewOperationalMetric = typeof operationalMetrics.$inferInsert;

export const scanLogs = vtTable("vt_scan_logs", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  equipmentId: text("equipment_id"),
  userId: text("user_id").notNull(),
  userEmail: text("user_email").notNull(),
  status: varchar("status", { length: 20 }).notNull(),
  note: text("note"),
  photoUrl: text("photo_url"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
}, (t) => ({
  clinicTimestampIdx: index("idx_vt_scan_logs_clinic_timestamp").on(t.clinicId, t.timestamp),
  clinicEquipmentIdx: index("idx_vt_scan_logs_clinic_equipment").on(t.clinicId, t.equipmentId),
  clinicUserIdx: index("idx_vt_scan_logs_clinic_user").on(t.clinicId, t.userId),
}));

export const transferLogs = vtTable("vt_transfer_logs", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  equipmentId: text("equipment_id"),
  fromFolderId: text("from_folder_id"),
  fromFolderName: text("from_folder_name"),
  toFolderId: text("to_folder_id"),
  toFolderName: text("to_folder_name"),
  userId: text("user_id").notNull(),
  note: text("note"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

export const whatsappAlerts = vtTable("vt_whatsapp_alerts", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  equipmentId: text("equipment_id").notNull(),
  equipmentName: text("equipment_name").notNull(),
  status: varchar("status", { length: 20 }).notNull(),
  note: text("note"),
  phoneNumber: text("phone_number"),
  message: text("message").notNull(),
  waUrl: text("wa_url").notNull(),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
});

export const alertAcks = vtTable("vt_alert_acks", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  equipmentId: text("equipment_id").notNull(),
  alertType: varchar("alert_type", { length: 30 }).notNull(),
  acknowledgedById: text("acknowledged_by_id").notNull(),
  acknowledgedByEmail: text("acknowledged_by_email").notNull(),
  acknowledgedAt: timestamp("acknowledged_at").defaultNow().notNull(),
  remindAt: timestamp("remind_at"),
  remindedAt: timestamp("reminded_at"),
  /** Two-level status: SEEN = awareness (alerts continue); RESOLVED = handled (alerts stop). */
  ackStatus: varchar("ack_status", { length: 10 }).notNull().default("SEEN"),
  /** Set when user marks as RESOLVED. Persisted — row is never deleted. */
  resolvedAt: timestamp("resolved_at"),
  resolvedById: text("resolved_by_id"),
  resolutionNote: text("resolution_note"),
}, (t) => ({
  clinicEquipmentAlertIdx: index("idx_vt_alert_acks_clinic_equipment_alert").on(t.clinicId, t.equipmentId, t.alertType),
  remindIdx: index("idx_vt_alert_acks_remind")
    .on(t.clinicId, t.remindAt)
    .where(sql`${t.remindedAt} IS NULL AND ${t.remindAt} IS NOT NULL`),
}));

export const undoTokens = vtTable("vt_undo_tokens", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  equipmentId: text("equipment_id").notNull(),
  actorId: text("actor_id").notNull(),
  scanLogId: text("scan_log_id").notNull(),
  previousState: text("previous_state").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  consumed: boolean("consumed").notNull().default(false),
});

/** Clinic-scoped equipment readiness rules (PR4); one row per (clinic_id, key). */
export const equipmentReadinessConfig = vtTable(
  "vt_equipment_readiness_config",
  {
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "restrict" }),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    clinicKeyPk: primaryKey({ columns: [table.clinicId, table.key] }),
  }),
);

/** Damage report log for equipment (T-24a · R-EQ-F3). */
export const damageEvents = vtTable(
  "vt_damage_events",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    equipmentId: text("equipment_id").notNull().references(() => equipment.id, { onDelete: "cascade" }),
    reportedBy: text("reported_by").notNull(),
    at: timestamp("at").defaultNow().notNull(),
    note: text("note"),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    clinicEquipmentIdx: index("idx_vt_damage_events_clinic_equipment").on(t.clinicId, t.equipmentId),
  }),
);
export type DamageEvent = typeof damageEvents.$inferSelect;
export type NewDamageEvent = typeof damageEvents.$inferInsert;
