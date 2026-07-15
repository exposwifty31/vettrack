/**
 * Docking P3 T3.4-ii — Room Sweep escalation ladder: pure stage math.
 *
 * Deliberately dependency-free (no `../db.js` import) so `computeEscalationStage`
 * is testable without a database connection, unlike sweep-escalation.service.ts
 * (which re-exports this and adds the DB-backed `isShiftSweepComplete`).
 *
 * Design (owner-confirmed):
 *  - Stage 1 @ 60 min before the Coordinator's shift-end: remind the Coordinator.
 *  - Stage 2 @ 40 min: notify the Senior Tech to follow up.
 *  - Stage 3 @ 20 min: auto-transfer responsibility to the Senior Tech.
 *  - Stage 4 @ shift-end: open to all techs + notify the manager.
 */

export type EscalationStage = 0 | 1 | 2 | 3 | 4;

export interface EscalationThresholds {
  /** Minutes-before-shift-end at which the Coordinator is reminded. */
  s1: number;
  /** Minutes-before-shift-end at which the Senior Tech is notified. */
  s2: number;
  /** Minutes-before-shift-end at which responsibility auto-transfers to the Senior Tech. */
  s3: number;
  /** Minutes-before-shift-end (0 = shift-end itself) at which it opens to all techs + manager. */
  s4: number;
}

/** Owner-confirmed defaults (60/40/20/0 minutes-before-end) — tunable per call site. */
export const DEFAULT_ESCALATION_THRESHOLDS: EscalationThresholds = { s1: 60, s2: 40, s3: 20, s4: 0 };

/**
 * Pure: the target escalation stage for a given "minutes remaining until
 * shift-end" reading. No DB, no side effects — deterministic and
 * unit-testable in isolation.
 *
 * Thresholds are INCLUSIVE at the boundary (A2-1, CodeRabbit PR #106) —
 * `minutesToShiftEnd == s1` reaches stage 1 exactly AT the threshold,
 * matching the docstrings above ("Stage 1 @ 60 min before shift-end", not
 * "just after 60 min").
 *
 *   minutesToShiftEnd >  s1        -> 0 (no escalation yet)
 *   s2 <  minutesToShiftEnd <= s1  -> 1 (coordinator reminded)
 *   s3 <  minutesToShiftEnd <= s2  -> 2 (senior notified)
 *   s4 <  minutesToShiftEnd <= s3  -> 3 (responsibility transferred)
 *   minutesToShiftEnd <= s4        -> 4 (open to all + manager notified)
 */
export function computeEscalationStage(
  minutesToShiftEnd: number,
  thresholds: EscalationThresholds = DEFAULT_ESCALATION_THRESHOLDS,
): EscalationStage {
  if (minutesToShiftEnd <= thresholds.s4) return 4;
  if (minutesToShiftEnd <= thresholds.s3) return 3;
  if (minutesToShiftEnd <= thresholds.s2) return 2;
  if (minutesToShiftEnd <= thresholds.s1) return 1;
  return 0;
}
