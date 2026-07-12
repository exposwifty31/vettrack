/**
 * Role-scoped nudge feed — compute-on-read response types (T-30a1-i · R-IN-F1).
 * Mirrors server/services/nudge-feed.service.ts + server/routes/nudges.ts.
 * No imports from ./index.ts.
 */

export type NudgeKind = "expiry" | "restock";

export interface Nudge {
  id: string;
  kind: NudgeKind;
  targetRole: string;
  entityId: string;
  message?: string;
  createdAt: string;
}

export interface NudgeFeedResponse {
  nudges: Nudge[];
}
