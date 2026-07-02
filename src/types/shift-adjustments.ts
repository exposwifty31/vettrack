/**
 * Shift-adjustment request types (Phase 1). A rostered person requests to work
 * past their scheduled end (`extend`) or to leave before it (`leave_early`) with
 * a required reason; an admin approves or rejects. Mirrors the server row shape
 * in server/schema/ops.ts (`vt_shift_adjustments`). No imports from ./index.ts.
 */

export type ShiftAdjustmentKind = "extend" | "leave_early";
export type ShiftAdjustmentStatus = "pending" | "approved" | "rejected" | "cancelled";
export type ShiftAdjustmentDecision = "approved" | "rejected";

export interface ShiftAdjustment {
  id: string;
  clinicId: string;
  requesterUserId: string;
  requesterName: string;
  kind: ShiftAdjustmentKind;
  baseShiftDate: string;
  baseShiftId: string | null;
  currentEndTime: string;
  requestedEndTime: string;
  reason: string;
  status: ShiftAdjustmentStatus;
  decidedByUserId: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

export interface CreateShiftAdjustmentRequest {
  kind: ShiftAdjustmentKind;
  requestedEndTime: string;
  reason: string;
}
