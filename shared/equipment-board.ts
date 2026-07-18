export type EquipmentReadinessStatus =
  | "ready"
  | "in_use"
  | "blocked"
  | "stale"
  | "overdue"
  | "unknown";

export type EquipmentBoardUnitRow = {
  equipmentId: string;
  displayName: string;
  typeName?: string;
  status: EquipmentReadinessStatus;
  locationName?: string;
  custodianName?: string;
  lastEvidenceAt?: string;
  lastHumanConfirmationAt?: string;
  rfid?: {
    lastSeenAt?: string;
    /** (clinicId, gatewayCode) → vt_rfid_readers.id. `null` = reader removed AFTER a valid
     * read (last-seen room still shown, no reader link) vs a resolved reader row. */
    readerId: string | null;
    readerName?: string;
    locationId?: string;
    locationName?: string;
    /** R-M1.3 — bounded location discriminator. 'external_zone' (boundary/dock NULL side) and
     * 'unresolved' (no resolvable room) are DISTINCT states — neither collapses to blank/null. */
    locationKind: "room" | "external_zone" | "unresolved";
    confidence: "low" | "medium" | "high";
    readsInWindow?: number;
  };
  evidenceConflict?: {
    type:
      // R-M1.3 — renamed from the inert `rfid_overrides_human_location` (which encoded the wrong
      // precedence). RFID is advisory: a conflict is a badge only, never an override (M1.0).
      | "rfid_location_conflict"
      | "ambiguous_rfid_location"
      | "custody_location_mismatch";
    action: "confirm_location" | "return" | "open_detail";
    message: string;
  };
  blockingReasons: string[];
  citationsCount: number;
  nextAction?: string;
  truthHref: string;
};

export type EquipmentBoardTypeRow = {
  typeId?: string;
  typeName: string;
  total: number;
  ready: number;
  inUse: number;
  blocked: number;
  stale: number;
  overdue: number;
  unknown: number;
  minimumReady?: number;
  belowMinimumReady: boolean;
};

export type EquipmentBoardLocationRow = {
  locationId?: string;
  locationName: string;
  totalCritical: number;
  ready: number;
  inUse: number;
  blocked: number;
  stale: number;
  overdue: number;
  unknown: number;
};

export type EquipmentBoardAlert = {
  id: string;
  type:
    | "critical_unit_blocked"
    | "critical_unit_stale"
    | "critical_unit_unknown"
    | "inspection_overdue"
    | "maintenance_overdue"
    | "type_below_minimum_ready"
    | "location_below_expected_ready"
    | "active_emergency_equipment_in_use"
    | "post_emergency_reset_required"
    | "repeated_repair"
    | "high_downtime"
    | "truth_resolution_failed"
    | "ambiguous_rfid_location"
    | "custody_location_mismatch"
    | "rfid_reader_offline"
    // R-M1.3 — RFID location evidence disagrees with the human-confirmed room (single read);
    // and a boundary/dock exit toward the external (NULL) endpoint (advisory, never a custody move).
    | "rfid_location_conflict"
    | "possible_egress";
  severity: "info" | "warning" | "critical";
  equipmentId?: string;
  message: string;
  recommendedAction?: string;
  citationIds?: string[];
};

/**
 * R-BDF-1.1 — Ambient board anomaly (glance-only). Closed v1 type enum; the derivation
 * lives in the board producer (`deriveBoardAnomalies`) and the telemetry union (R-BDF-1.3)
 * mirrors this enum. `since` is the condition's first-observed ISO instant; `sourceRef` is
 * the {table,id} of the row that tripped the rule.
 */
/**
 * Runtime source of truth for the closed anomaly-type enum. The type union AND every server-side
 * validator (e.g. the R-BDF-1.3 telemetry gate in server/routes/realtime.ts) derive from this one
 * tuple, so a new anomaly type cannot compile in one place while being silently rejected in another.
 */
export const BOARD_ANOMALY_TYPES = ["battery_critical", "cart_unverified", "rfid_reader_offline"] as const;

export type BoardAnomalyType = (typeof BOARD_ANOMALY_TYPES)[number];

/** Two-level glance severity: `calm` stays quiet, `pressure` escalates (color+size). */
export type BoardAnomalySeverity = "calm" | "pressure";

export type BoardAnomaly = {
  type: BoardAnomalyType;
  unitId: string;
  severity: BoardAnomalySeverity;
  since: string;
  sourceRef: { table: string; id: string };
};

export type EquipmentBoardRoiSignals = {
  overusedUnits: unknown[];
  underusedUnits: unknown[];
  repairReplaceCandidates: unknown[];
  typeShortages: unknown[];
  duplicatePurchaseRisks: unknown[];
};

/** Power posture across critical equipment (derived from latest returns; no battery %). */
export type EquipmentBoardPowerBlock = {
  plugged: number;
  unplugged: number;
  alert: number;
};

/** Dock capacity + occupancy across the clinic. */
export type EquipmentBoardDocksBlock = {
  total: number;
  occupied: number;
  ready: number;
};

/** Equipment-waitlist depth (active entries). */
export type EquipmentBoardWaitlistBlock = {
  depth: number;
};

/** Staging-queue depth (active entries). */
export type EquipmentBoardStagingBlock = {
  depth: number;
};

export type EquipmentCommandBoardSnapshot = {
  generatedAt: string;
  clinicId: string;
  overview: {
    totalCritical: number;
    ready: number;
    inUse: number;
    blocked: number;
    stale: number;
    overdue: number;
    unknown: number;
    belowThresholdTypes: number;
    activeEmergencyUnits: number;
  };
  byType: EquipmentBoardTypeRow[];
  byLocation: EquipmentBoardLocationRow[];
  criticalUnits: EquipmentBoardUnitRow[];
  alerts: EquipmentBoardAlert[];
  activeEmergency?: {
    sessionId: string;
    startedAt: string;
    elapsedMs: number;
    linkedEquipment: Array<{
      equipmentId: string;
      displayName: string;
      typeName?: string;
      currentStatus: EquipmentReadinessStatus;
      locationName?: string;
    }>;
  };
  // Phase 5 (C2) — OPTIONAL additive enrichment blocks. Each degrades to
  // undefined independently server-side; every client reader must be tolerant
  // (render nothing when a block is absent). Never assume presence.
  power?: EquipmentBoardPowerBlock;
  docks?: EquipmentBoardDocksBlock;
  waitlist?: EquipmentBoardWaitlistBlock;
  staging?: EquipmentBoardStagingBlock;
  /**
   * R-BDF-1.1 — additive ambient anomaly pass (glance-only). Absent/empty when nothing
   * trips; every client reader must be tolerant (render nothing when the block is absent).
   */
  anomalies?: BoardAnomaly[];
  roiSignals: EquipmentBoardRoiSignals;
};
