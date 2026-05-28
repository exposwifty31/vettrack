import { request } from "./request-core";
import type {
  AckErHandoffRequest,
  AckErHandoffResponse,
  AssignErIntakeRequest,
  AssignErIntakeResponse,
  CreateErHandoffRequest,
  CreateErHandoffResponse,
  CreateErIntakeRequest,
  ErAssigneesResponse,
  ErBoardResponse,
  ErEligibleHospitalizationsResponse,
  ErImpactResponse,
  ErIntakeResponse,
  ErKpiWindowDays,
  ErModeResponse,
  ErModeState,
} from "../../shared/er-types.js";

/** React Query key — shared by ER concealment guard and layout. */
export const ER_MODE_QUERY_KEY = ["er-mode-state"] as const;

export class ErApiNotImplementedError extends Error {
  constructor(message = "ER API route not implemented") {
    super(message);
    this.name = "ErApiNotImplementedError";
  }
}

/** Implemented REST paths for diagnostics / admin tooling. */
export const ER_API_IMPLEMENTED_ROUTES = [
  "GET /api/er/mode",
  "GET /api/er/status",
  "GET /api/er/stream",
  "GET /api/er/events",
  "POST /api/er/admin/toggle-global-mode",
  "PATCH /api/er/mode",
  "GET /api/er/board",
  "GET /api/er/assignees",
  "POST /api/er/intake",
  "PATCH /api/er/intake/:id/assign",
  "PATCH /api/er/intake/:id/accept",
  "POST /api/er/admission-state",
  "DELETE /api/er/admission-state",
  "GET /api/er/admission-state",
  "POST /api/er/intake/:id/admission-complete",
  "PATCH /api/er/intake/:id/enrich",
  "GET /api/er/handoffs/eligible-hospitalizations",
  "POST /api/er/handoffs",
  "POST /api/er/handoffs/:id/ack",
  "GET /api/er/impact",
  // GET /api/er/queue is intentionally omitted — the route exists but
  // responds 501 COMING_SOON (queue feature not built). See server/routes/er.ts.
] as const;

function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  return request<T>(url, init);
}

export async function getErMode(): Promise<ErModeResponse> {
  return apiRequest<ErModeResponse>("/api/er/mode");
}

/** Same payload as {@link getErMode}; prefer after SSE reconnect to resync without waiting for broadcast. */
export async function getErStatus(): Promise<ErModeResponse> {
  return apiRequest<ErModeResponse>("/api/er/status");
}

/** Admin toggle — body matches `POST /api/er/admin/toggle-global-mode`. */
export async function toggleErGlobalMode(body: {
  activate: boolean;
}): Promise<{ erModeState: ErModeState; requestId: string }> {
  return apiRequest<{ erModeState: ErModeState; requestId: string }>("/api/er/admin/toggle-global-mode", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getErBoard(): Promise<ErBoardResponse> {
  return apiRequest<ErBoardResponse>("/api/er/board");
}

export async function getErAssignees(): Promise<ErAssigneesResponse> {
  return apiRequest<ErAssigneesResponse>("/api/er/assignees");
}

export async function getErEligibleHospitalizations(): Promise<ErEligibleHospitalizationsResponse> {
  return apiRequest<ErEligibleHospitalizationsResponse>("/api/er/handoffs/eligible-hospitalizations");
}

export async function createErIntake(body: CreateErIntakeRequest): Promise<ErIntakeResponse> {
  return apiRequest<ErIntakeResponse>("/api/er/intake", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function assignErIntake(id: string, body: AssignErIntakeRequest): Promise<AssignErIntakeResponse> {
  return apiRequest<AssignErIntakeResponse>(`/api/er/intake/${encodeURIComponent(id)}/assign`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function createErHandoff(body: CreateErHandoffRequest): Promise<CreateErHandoffResponse> {
  return apiRequest<CreateErHandoffResponse>("/api/er/handoffs", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function ackErHandoff(itemId: string, body?: AckErHandoffRequest): Promise<AckErHandoffResponse> {
  return apiRequest<AckErHandoffResponse>(`/api/er/handoffs/${encodeURIComponent(itemId)}/ack`, {
    method: "POST",
    body: JSON.stringify(body ?? {}),
  });
}

export async function getErImpact(params?: { window?: ErKpiWindowDays }): Promise<ErImpactResponse> {
  const windowDays = params?.window ?? 14;
  return apiRequest<ErImpactResponse>(`/api/er/impact?window=${encodeURIComponent(String(windowDays))}`);
}

export async function acceptErPatient(
  intakeId: string,
  userId: string | null,
): Promise<{ id: string; acceptedByUserId: string | null; updatedAt: string }> {
  return apiRequest(`/api/er/intake/${encodeURIComponent(intakeId)}/accept`, {
    method: "PATCH",
    body: JSON.stringify({ userId }),
  });
}

export async function enterAdmissionState(
  intakeEventId: string,
): Promise<{ id: string; userId: string; intakeEventId: string | null; enteredAt: string }> {
  return apiRequest("/api/er/admission-state", {
    method: "POST",
    body: JSON.stringify({ intakeEventId }),
  });
}

export async function exitAdmissionState(): Promise<{
  cleared: boolean;
  handoffDebtWarning: boolean;
  pendingCount: number;
}> {
  return apiRequest("/api/er/admission-state", { method: "DELETE" });
}

export async function getAdmissionState(): Promise<{
  active: boolean;
  state: { id: string; intakeEventId: string | null; enteredAt: string } | null;
}> {
  return apiRequest("/api/er/admission-state");
}

export async function completeAdmission(
  intakeId: string,
): Promise<{ id: string; status: string; handoffPending: boolean; completedAt: string }> {
  return apiRequest(`/api/er/intake/${encodeURIComponent(intakeId)}/admission-complete`, {
    method: "POST",
  });
}

export async function enrichErIntake(
  intakeId: string,
  data: { animalId?: string; ownerName?: string },
): Promise<{ id: string; enrichedAt: string }> {
  return apiRequest(`/api/er/intake/${encodeURIComponent(intakeId)}/enrich`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}
