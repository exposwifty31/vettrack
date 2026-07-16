import type { EquipmentCommandBoardSnapshot } from "../../shared/equipment-board.js";
export type { EquipmentCommandBoardSnapshot };

/** Ward display snapshot (`GET /api/display/snapshot`). */
export interface DisplaySnapshotEquipment {
  id: string;
  name: string;
  status: string;
  /** Legacy — true when checked out. */
  inUse: boolean;
  /** Staff holding the unit (display name or email), if checked out. */
  heldBy: string | null;
  /** Last NFC/scan sighting (`vt_equipment.last_seen`). */
  lastCheckInAt: string | null;
  /** Best-effort location: usually-found-here → room → checkout note → static location. */
  probableLocation: string | null;
  /** Docked + ready + available (operational state). */
  isDeployable: boolean;
  custodyState: string;
  readinessState: string;
  usageState: string;
}

export interface DisplaySnapshotTask {
  id: string;
  startTime: string;
  taskType: string | null;
  notes: string | null;
  status?: string;
  animalName?: string | null;
}

export interface DisplaySnapshotCodeBlueSession {
  id: string;
  startedAt: string;
  managerUserName: string;
  preCheckPassed: boolean | null;
  pushSentAt: string;
  linkedEquipment: Array<{ id: string; name: string }>;
  logEntries: Array<{
    elapsedMs: number;
    label: string;
    category: string;
    equipmentId?: string | null;
    loggedByName: string;
  }>;
  presence: Array<{ userId: string; userName: string; lastSeenAt: string }>;
}

export interface DisplaySnapshotHospitalization {
  id: string;
  status: string;
  ward: string | null;
  bay: string | null;
  admittedAt: string;
  admittingVetName?: string | null;
  overdueTaskCount?: number;
  overdueTaskLabel?: string | null;
  animalId?: string;
  animal: {
    name: string;
    species?: string | null;
    breed?: string | null;
    weightKg?: string | null;
  };
}

export interface DisplaySnapshot {
  currentTime: string;
  currentShift: Array<{ employeeName: string; role: string }>;
  hospitalizations: DisplaySnapshotHospitalization[];
  equipment: DisplaySnapshotEquipment[];
  upcomingTasks: DisplaySnapshotTask[];
  overdueTasks: DisplaySnapshotTask[];
  activeAlertCount: number;
  totalOverdueCount: number;
  crashCartStatus: {
    lastCheckedAt: string;
    allPassed: boolean;
    performedByName: string;
  } | null;
  codeBlueSession: DisplaySnapshotCodeBlueSession | null;
  /** Equipment command board — present when buildCommandBoardSnapshot succeeds. */
  commandBoard?: EquipmentCommandBoardSnapshot | null;
}

export interface CrashCartItem {
  id: string;
  key: string;
  label: string;
  requiredQty: number;
  expiryWarnDays: number | null;
  sortOrder: number;
  active: boolean;
}

export interface CreateCrashCartItemRequest {
  key: string;
  label: string;
  requiredQty?: number;
  expiryWarnDays?: number | null;
}

export interface UpdateCrashCartItemRequest {
  label?: string;
  requiredQty?: number;
  expiryWarnDays?: number | null;
  sortOrder?: number;
}

export interface StartCodeBlueRequest {
  patientId?: string | null;
  hospitalizationId?: string | null;
  preCheckPassed?: boolean;
}

export interface StartCodeBlueResponse {
  sessionId: string;
}

export interface EndCodeBlueRequest {
  outcome: "rosc" | "died" | "transferred" | "ongoing";
}

/** Bounded durable delivery state of the one-tap team-page outbox row (R-CBF-1.1). */
export type OneTapPagingState = "queued" | "processing" | "sent" | "failed";

/**
 * R-CBF-1.1 — one-tap Code Blue orchestration request. The client generates one
 * idempotency token per hold gesture (R-CBF-1.3) and persists it across retries;
 * `locationHint` is an optimistic hint only — the server re-derives the
 * initiating location authoritatively and never trusts the client value to steer
 * cart selection.
 */
export interface OneTapCodeBlueRequest {
  idempotencyToken: string;
  managerUserId: string;
  managerUserName: string;
  preCheckPassed?: boolean;
  /** Optimistic client location hint — re-validated server-side, never trusted to steer. */
  locationHint?: { roomId: string | null };
}

/** R-CBF-1.1 — one-tap Code Blue orchestration response. */
export interface OneTapCodeBlueResponse {
  /** How the request resolved: a fresh start, an idempotent replay, or a retryable conflict. */
  outcome: "created" | "replay" | "conflict";
  sessionId?: string;
  /** The advisory soft-reserved nearest-ready cart, or null when none was available. */
  reservedCartId?: string | null;
  /** CURRENT durable paging state of the team page (never a static "success"). */
  pagingState?: OneTapPagingState | null;
  /** Present on `conflict` — a retryable reason code. */
  reason?: "active_lease" | "fence_superseded" | "active_session_exists";
}

export interface CodeBlueDispense {
  id: string;
  sessionId: string;
  itemName: string;
  quantity: number;
  dispensedAt: string;
}
