/**
 * Phase 5 PR 5.1 — Clinical-invariant evaluator family types.
 *
 * Foundation only. PR 5.1 declares the type surface; no evaluator
 * consumes these types yet (the evaluator lands in PR 5.2; route
 * wiring lands in PR 5.3 / 5.4).
 *
 * This family enforces dispense-boundary orphan-use invariants. It is
 * NOT an authority evaluator (Phase 5 master plan §5 / CI-14). It is
 * operationally co-located with the authority enforcement framework
 * ONLY to reuse rollout mechanics — per-clinic flag resolver, 10s
 * TTL, shadow → enforce envelope, audit / metrics style.
 *
 * Mode union (off | shadow | enforce):
 *   - off: evaluator is not invoked on the wired request path
 *     (Phase 5 plan §15 PR 5.3 / 5.4 wiring contract). No
 *     clinical-validation queries are issued in off mode (CI-27).
 *   - shadow: evaluator may run but never returns `deny`. Orphan
 *     detections increment shadow counters and emit a sampled
 *     best-effort audit row (CI-25).
 *   - enforce: evaluator may return `deny` on orphan. The wired call
 *     site rolls back the mutation transaction and returns 422
 *     (Phase 5 plan §6).
 *
 * Frozen post-merge (Phase 5 plan §19.5, §19.6, §19.19, §19.31):
 *   - The `ClinicalInvariantEnforcementMode` union;
 *   - the `ClinicalInvariantVerdict` shape and `disposition` values;
 *   - the single deny reason `ORPHAN_DISPENSE_BLOCKED`;
 *   - `containerId: string` non-nullability on `ClinicalInvariantContext`.
 *
 * Import boundary (Phase 5 plan §17 import-boundary rule + §19.17):
 *   This file imports only pure type contracts — `AuditDbExecutor` from
 *   the audit module and `OrphanLineDetail` / `DispenseLineForValidation`
 *   from the pure validation utility `dispense-order-validation.ts`.
 *   It MUST NOT import from any other enforcement-family file.
 */

import type { AuditDbExecutor } from "../../audit.js";
import type {
  DispenseLineForValidation,
  OrphanLineDetail,
} from "../../dispense-order-validation.js";

export type ClinicalInvariantEnforcementMode = "off" | "shadow" | "enforce";

/**
 * The single deny reason emitted by the Phase 5 evaluator
 * (Phase 5 plan §19.6). Per-line `OrphanReasonCode` detail lives on
 * `ClinicalInvariantDeny.orphanLines[].reasons`.
 */
export type ClinicalInvariantDenyReason = "ORPHAN_DISPENSE_BLOCKED";

/**
 * Allow-side `disposition` enum (Phase 5 plan §19.31). `disposition`
 * is an observability tag used by the wired call site to bucket
 * allow-path outcomes; it never changes the response shape.
 *
 *   - "OFF": evaluator returned allow because mode resolved to off.
 *     (In practice the wired call site short-circuits before invoking
 *     the evaluator in off mode — see Phase 5 plan §15 PR 5.3 / 5.4
 *     wiring contract. The evaluator module retains a defensive
 *     off-mode short-circuit for pure unit-test coverage only.)
 *   - "EMERGENCY_BYPASS": carve-out fired (`isEmergency=true` plus a
 *     valid `bypassReason`); evaluator was not invoked further.
 *   - "WOULD_HAVE_BLOCKED_SHADOW": shadow-mode orphan detection. In
 *     enforce mode this case would have produced `action: "deny"`.
 *   - "DEGRADED_MODE_FAIL_OPEN": fail-open allow path
 *     (Phase 5 plan §8.2 / CI-8 / §19.26). Emitted only when
 *     `SMART_COP_VALIDATION_FAIL_OPEN=true` and the evaluator's DB
 *     reads threw.
 */
export type ClinicalInvariantDisposition =
  | "OFF"
  | "EMERGENCY_BYPASS"
  | "WOULD_HAVE_BLOCKED_SHADOW"
  | "DEGRADED_MODE_FAIL_OPEN";

export interface ClinicalInvariantAllow {
  action: "allow";
  disposition?: ClinicalInvariantDisposition;
  /**
   * Phase 5 PR 5.5 — populated when
   * `disposition === "WOULD_HAVE_BLOCKED_SHADOW"`. Carries the orphan
   * detail the evaluator observed, so the wiring layer can emit the
   * sampled shadow audit **after the mutation transaction commits**.
   *
   * Emitting inside the tx would risk producing a false-positive
   * audit row when the request subsequently fails and the tx rolls
   * back (Codex P2 review on PR 5.5). Keeping the orphan detail on
   * the verdict lets the wiring layer defer emission to post-commit
   * without breaking the evaluator's read-only-inside-the-tx
   * invariant (CI-24).
   *
   * Field is INTERNAL passport data — it carries the same
   * `OrphanLineDetail[]` shape used by the `deny` arm of the union.
   * Clients that only read `action` / `disposition` are unaffected.
   */
  orphanLines?: OrphanLineDetail[];
}

export interface ClinicalInvariantDeny {
  action: "deny";
  reason: ClinicalInvariantDenyReason;
  orphanLines: OrphanLineDetail[];
}

export type ClinicalInvariantVerdict =
  | ClinicalInvariantAllow
  | ClinicalInvariantDeny;

/**
 * Pure-data context passed to the Phase 5 evaluator. Hydrated by the
 * wired call site inside the existing mutation transaction
 * (Phase 5 plan §15 PR 5.3 / PR 5.4 wiring contract / CI-28). The
 * evaluator is read-only inside the tx (CI-24).
 *
 * `containerId` is intentionally non-nullable (Phase 5 plan §19.19) —
 * this is what keeps the `completeTask` ambiguity out of the core
 * Phase 5 rollout. Widening to `string | null` (e.g. for completion-
 * path coverage) is a separate post-Phase-5 follow-up workstream.
 *
 * `lines` reuses the pure type contract `DispenseLineForValidation`
 * from `dispense-order-validation.ts` so the evaluator (PR 5.2) can
 * forward them directly to `evaluateDispenseAgainstOrders`.
 */
export interface ClinicalInvariantContext {
  tx: AuditDbExecutor;
  clinicId: string;
  animalId: string | null;
  containerId: string;
  lines: DispenseLineForValidation[];
  isEmergency: boolean;
  bypassReason: string | null;
  requestId: string;
}
