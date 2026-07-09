// Phase 9 — Display-device pairing API types.
//
// One type per response shape (per the "API client pattern"), grounded in
// server/routes/display.ts. The device registry NEVER exposes the token or its
// hash; only `/pair/claim` returns the raw token, and only once.

/** A paired display device as returned by the admin registry (GET /devices, PATCH rename). */
export interface DisplayDevice {
  id: string;
  name: string;
  /** ISO timestamp of the last heartbeat, or null if never seen. */
  lastSeenAt: string | null;
  /** ISO timestamp when the device was revoked, or null while active. */
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** POST /pair/issue — a short-lived pairing code an admin shows on the display to pair it. */
export interface DisplayPairingCode {
  code: string;
  /** ISO timestamp after which the code can no longer be claimed. */
  expiresAt: string;
}

/** POST /pair/claim — the ONE-TIME device credential handed back to a claiming display. */
export interface DisplayPairClaim {
  id: string;
  /** Raw `vtd_`-prefixed device token — returned exactly once; persist immediately. */
  token: string;
  name: string;
  clinicId: string;
}
