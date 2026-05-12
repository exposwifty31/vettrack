export type ShiftPatientHandoffStatus = "draft" | "submitted" | "reviewed" | "cancelled";
export type ShiftPatientHandoffItemStatus = "draft" | "ready" | "skipped" | "invalidated";

// GET /eligible-patients
export interface HandoffEligiblePatient {
  hospitalizationId: string;
  animalId: string;
  animalName: string;
  status: string;
  ward: string | null;
  bay: string | null;
}
export interface HandoffEligiblePatientsResponse {
  patients: HandoffEligiblePatient[];
}

// GET /eligible-staff
export interface HandoffEligibleStaff {
  id: string;
  displayName: string;
  role: string;
}
export interface HandoffEligibleStaffResponse {
  staff: HandoffEligibleStaff[];
}

// POST / → 201
export interface CreateHandoffResponse {
  id: string;
  status: "draft";
  version: number;
  createdAt: string;
}

// Item detail (embedded in GET /:id and GET /mine)
export interface HandoffItemDetail {
  id: string;
  hospitalizationId: string;
  animalId: string;
  animalName: string;
  ward: string | null;
  bay: string | null;
  status: ShiftPatientHandoffItemStatus;
  skipReason: string | null;
  currentStability: string;
  pendingTasksNote: string;
  criticalWarnings: string;
  clinicalNote: string;
  patientSnapshot: Record<string, unknown>;
  version: number;
  updatedAt: string;
}

// Header summary row (GET /mine)
export interface HandoffListItem {
  id: string;
  outgoingUserId: string;
  outgoingUserName: string;
  receivingUserId: string;
  receivingUserName: string;
  status: ShiftPatientHandoffStatus;
  version: number;
  patientCount: number;
  createdAt: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  cancelledAt: string | null;
}
export interface MyHandoffsResponse {
  outgoing: HandoffListItem[];
  incoming: HandoffListItem[];
}

// GET /:id
export interface HandoffDetailResponse extends HandoffListItem {
  items: HandoffItemDetail[];
}

// PUT /:id/items/:hospitalizationId → 200
export interface UpsertItemRequest {
  version?: number;
  status?: "draft" | "ready" | "skipped";
  skipReason?: string;
  currentStability?: string;
  pendingTasksNote?: string;
  criticalWarnings?: string;
  clinicalNote?: string;
}
export interface UpsertItemResponse {
  id: string;
  status: ShiftPatientHandoffItemStatus;
  version: number;
  updatedAt: string;
}

// POST /:id/submit → 200
export interface SubmitHandoffRequest {
  version: number;
}
export interface SubmitHandoffResponse {
  id: string;
  status: "submitted";
  version: number;
  submittedAt: string;
}

// POST /:id/review → 200
export interface ReviewHandoffRequest {
  version: number;
}
export interface ReviewHandoffResponse {
  id: string;
  status: "reviewed";
  version: number;
  reviewedAt: string;
}

// POST /:id/cancel → 200
export interface CancelHandoffRequest {
  version: number;
}
export interface CancelHandoffResponse {
  id: string;
  status: "cancelled";
  version: number;
  cancelledAt: string;
}

// 409 body when submit finds discharged/missing patients
export interface HandoffItemsInvalidatedError {
  code: "HANDOFF_ITEMS_INVALIDATED";
  invalidatedItems: Array<{ id: string; hospitalizationId: string; reason: string }>;
}
