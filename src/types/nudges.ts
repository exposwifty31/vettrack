/**
 * Role-scoped nudge feed — compute-on-read response types (T-30a1-i · R-IN-F1).
 * Mirrors server/services/nudge-feed.service.ts + server/routes/nudges.ts.
 * No imports from ./index.ts.
 */

export type NudgeKind = "expiry" | "restock";

export interface Nudge {
  id: string;
  kind: NudgeKind;
  // Mirrors server UserRole (server/services/nudge-feed.service.ts); kept as
  // `string` rather than importing the server type, per this file's header
  // (no ./index.ts / server imports) — a future server-side role addition
  // won't surface as a client type error, but avoids coupling this file to
  // server code.
  targetRole: string;
  entityId: string;
  message?: string;
  createdAt: string;
}

export interface NudgeFeedResponse {
  nudges: Nudge[];
}
