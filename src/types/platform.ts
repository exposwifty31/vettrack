/**
 * Platform / admin types (Slice 6a).
 * Auth, shifts, audit, support, metrics, clinical shift handover, patient handoff re-exports.
 * Import from shared only — never from ./index.ts.
 */
import type { AuthoritySnapshot } from "../../shared/authority.js";

export type UserRole = "admin" | "vet" | "technician" | "senior_technician" | "lead_technician" | "vet_tech" | "student";
export type ShiftRole = "technician" | "senior_technician" | "admin";

export type UserStatus = "pending" | "active" | "blocked";

export interface Shift {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  employeeName: string;
  role: ShiftRole;
}

export interface User {
  id: string;
  clerkId: string;
  email: string;
  name: string;
  displayName: string;
  role: UserRole;
  secondaryRole?: string | null;
  /**
   * Advisory role the user requested at sign-up (staging column, T24b).
   * Never the authoritative role — surfaced read-only to admins as a hint.
   */
  requestedRole?: string | null;
  effectiveRole?: UserRole | ShiftRole;
  roleSource?: "shift" | "permanent";
  activeShift?: Shift | null;
  resolvedAt?: string;
  status: UserStatus;
  createdAt: string;
  deletedAt?: string | null;
  deletedBy?: string | null;
  avatarUrl?: string | null;
  authority?: AuthoritySnapshot;
}

export interface ShiftImport {
  id: string;
  importedAt: string;
  importedBy: string;
  importedByName?: string | null;
  importedByEmail?: string | null;
  filename: string;
  rowCount: number;
}

export interface ShiftCsvRow {
  rowNumber: number;
  date: string;
  startTime: string;
  endTime: string;
  employeeName: string;
  shiftName: string;
  role: ShiftRole;
}

export interface ShiftCsvIssue {
  rowNumber: number;
  reason: string;
  data: Record<string, string>;
}

/** Doctor CSV shift-import row shape (userId column) — T18. */
export interface DoctorShiftCsvRow {
  rowNumber: number;
  date: string;
  startTime: string;
  endTime: string;
  userId: string;
  shiftName: string;
  operationalRole: string;
}

export interface RosterShiftImportPreview {
  kind: "roster";
  filename: string;
  summary: {
    totalRows: number;
    validRows: number;
    skippedRows: number;
  };
  rows: ShiftCsvRow[];
  issues: ShiftCsvIssue[];
}

export interface DoctorShiftImportPreview {
  kind: "doctor";
  filename: string;
  summary: {
    totalRows: number;
    validRows: number;
    skippedRows: number;
  };
  rows: DoctorShiftCsvRow[];
  issues: ShiftCsvIssue[];
}

/** T18: the import UI's preview/confirm responses are tagged `kind` so an
 * admin-uploaded doctor CSV (userId column) renders through the doctor
 * branch instead of being force-fit into roster columns. */
export type ShiftImportPreview = RosterShiftImportPreview | DoctorShiftImportPreview;

export interface RosterShiftImportResult {
  kind: "roster";
  importId: string;
  filename: string;
  insertedRows: number;
  skippedRows: number;
  issues: ShiftCsvIssue[];
}

export interface DoctorShiftImportResult {
  kind: "doctor";
  importId: string;
  filename: string;
  insertedRows: number;
  skippedRows: number;
  issues: ShiftCsvIssue[];
}

export type ShiftImportResult = RosterShiftImportResult | DoctorShiftImportResult;

/** T19: accepted-shift-name keyword lists surfaced by GET /api/shifts/import/shift-names. */
export interface ShiftNameHints {
  technician: string[];
  seniorTechnician: string[];
  admin: string[];
}

export interface ShiftHandoverSession {
  id: string;
  clinicId: string;
  startedAt: string;
  endedAt: string | null;
  startedByUserId: string;
  note: string | null;
}

export interface ShiftHandoverSummaryCounts {
  patientCount: number;
  pendingTaskCount: number;
  overdueCount: number;
  unresolvedEmergencyCount: number;
}

export interface ShiftHandoverMedTask {
  id: string;
  status: string;
  drugId: string;
  dueAt: string | null;
}

export interface ShiftHandoverEmergencyDispense {
  id: string;
  createdAt: string;
}

export interface ShiftHandoverActiveAlert {
  alertType: string;
  ackStatus: string;
}

export interface ShiftHandoverPatient {
  hospitalizationId: string;
  animalId: string;
  animalName: string;
  status: string;
  ward: string | null;
  bay: string | null;
  pendingMedicationTasks: ShiftHandoverMedTask[];
  overdueMedicationCount: number;
  unresolvedEmergencyDispenses: ShiftHandoverEmergencyDispense[];
}

export interface ShiftHandoverPatientsResponse {
  patients: ShiftHandoverPatient[];
  activeAlerts: ShiftHandoverActiveAlert[];
  summaryCounts: ShiftHandoverSummaryCounts;
  generatedAt: string;
}

/** Raw snapshot row returned by GET /api/shift-handover/snapshot/latest.
 *  patientsPayload and summaryCounts are historical JSONB — treat as unknown. */
export interface ShiftHandoverSnapshotRecord {
  id: string;
  clinicId: string;
  shiftSessionId: string;
  generatedAt: string;
  patientsPayload: unknown;
  summaryCounts: unknown;
  createdBy: string;
}

export interface UploadUrlRequest {
  name: string;
  size: number;
  contentType: string;
}

export interface UploadUrlResponse {
  uploadURL: string;
  objectPath: string;
}

/** OFF-08 — server aggregate counters from client offline queue telemetry. */
export interface OfflineSyncMetricsSnapshot {
  pendingReported: {
    zero: number;
    one: number;
    twoToFive: number;
    sixPlus: number;
  };
  oldestPendingAge: {
    none: number;
    lt60s: number;
    lt5m: number;
    lt1h: number;
    gte1h: number;
  };
  deadLetter: {
    zero: number;
    one: number;
    twoPlus: number;
  };
  conflict: {
    zero: number;
    onePlus: number;
  };
  sessionSuccess: {
    zero: number;
    oneToFive: number;
    sixPlus: number;
  };
  sessionConflict: {
    zero: number;
    oneToFive: number;
    sixPlus: number;
  };
  sessionDead: {
    zero: number;
    oneToFive: number;
    sixPlus: number;
  };
  idempotencyReplayServed: number;
  engine: {
    permanentFailure: number;
    circuitOpen: number;
  };
}

export interface SystemMetrics {
  uptime: number;
  memoryMb: number;
  memoryTotalMb: number;
  activeSessions: number;
  pendingSyncCount?: number;
  syncMetrics?: {
    syncSuccessCount: number;
    syncFailCount: number;
  };
  offlineSync?: OfflineSyncMetricsSnapshot;
}

export type SupportTicketSeverity = "low" | "medium" | "high";
export type SupportTicketStatus = "open" | "in_progress" | "resolved";

export interface SupportTicket {
  id: string;
  title: string;
  description: string;
  severity: SupportTicketSeverity;
  status: SupportTicketStatus;
  userId: string;
  userEmail: string;
  pageUrl?: string | null;
  deviceInfo?: string | null;
  appVersion?: string | null;
  adminNote?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSupportTicketRequest {
  title: string;
  description: string;
  severity: SupportTicketSeverity;
  pageUrl?: string;
  deviceInfo?: string;
  appVersion?: string;
}

export interface AuditLog {
  id: string;
  actionType: string;
  performedBy: string;
  performedByEmail: string;
  /** Resolved from vt_users when performedBy matches a user id in this clinic. */
  performedByName?: string | null;
  targetId: string | null;
  targetType: string | null;
  metadata: Record<string, unknown> | null;
  timestamp: string;
}

export interface AuditLogResponse {
  items: AuditLog[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface AuditLogFilters {
  actionType?: string;
  from?: string;
  to?: string;
  page?: number;
}

export interface ShiftCompletionUser {
  userId: string;
  name: string;
  email: string;
  totalScans: number;
  shiftCount: number;
  avgScansPerShift: number;
  zeroCaptureShifts: number;
}

export interface ShiftCompletionResult {
  from: string;
  to: string;
  users: ShiftCompletionUser[];
}

