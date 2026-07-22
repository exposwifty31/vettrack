/** Clinic join codes — invite-free sign-up (POST /api/auth/join-clinic). */

/** Result of redeeming a join code for pending clinic membership. */
export type ClinicJoinResult =
  | { ok: true; status: string; alreadyMember?: boolean }
  | { ok: false; reason: "INVALID_JOIN_CODE" | "UNAUTHORIZED" | "ERROR" };

/** GET /api/admin/clinic-join-code — null until an admin generates one. */
export interface ClinicJoinCodeResponse {
  joinCode: string | null;
}
