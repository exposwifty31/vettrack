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
    readerId?: string;
    readerName?: string;
    locationId?: string;
    locationName?: string;
    confidence: "low" | "medium" | "high";
    readsInWindow?: number;
  };
  evidenceConflict?: {
    type:
      | "rfid_overrides_human_location"
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
    | "rfid_reader_offline";
  severity: "info" | "warning" | "critical";
  equipmentId?: string;
  message: string;
  recommendedAction?: string;
  citationIds?: string[];
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
  roiSignals: EquipmentBoardRoiSignals;
};
