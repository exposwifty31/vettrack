/**
 * Phase 5 PR 5.6 — clinical-invariant JSON error envelope.
 *
 * Backend-only helper that produces the 422 response body for the
 * clinical-invariant evaluator's enforce-mode deny path. Created in
 * PR 5.6; first call site (the 422 path itself) lands in PR 5.7.
 *
 * Stable contract (Phase 5 plan §6.3 stability matrix, §19.28):
 *
 *   - `code` = `"CLINICAL_INVARIANT_VIOLATION"` (frozen)
 *   - `reason` = `"ORPHAN_DISPENSE_BLOCKED"` (frozen)
 *   - `clinical` = `true` (frozen — discriminator for the additive
 *     `clinical: true` + `cop` branch on top of the existing
 *     `apiError` envelope)
 *   - `requestId` — stable correlation id passed from the route layer
 *   - `cop.kind` = `"orphan_dispense"` (frozen)
 *   - `cop.orphanLines[]` — `itemId`, `quantity`, `reasons`,
 *     `matchingOrderIds` are stable machine-readable; `label` is
 *     best-effort and not part of the contract
 *
 * Non-contractual:
 *   - `message` — fixed English fallback text suitable only for
 *     server logs / developer triage. The future UI/i18n phase may
 *     replace or wrap it. Clients MUST NOT depend on its exact
 *     content or localise off it (CI-19 / §19.28).
 *
 * Forbidden in this PR:
 *   - No locale-file changes (`locales/en.json`, `locales/he.json`
 *     remain untouched).
 *   - No `t.cop.*` keys.
 *   - No client-side consumer (PR 5.7 is the first caller).
 *   - No localization tests.
 *
 * Note: this helper deliberately does NOT include the legacy `error`
 * alias field (the `{ error: code }` compat field present on the
 * existing route-local `apiError` helpers). The client's `ApiError`
 * reads `payload.code` first and only falls back to `payload.error`
 * when `code` is missing — see `src/lib/api.ts` `ApiError`
 * constructor. Omitting `error` here keeps the envelope minimal and
 * matches the Phase 5 plan §6.3 example shape exactly.
 */

import type { OrphanLineDetail } from "./dispense-order-validation.js";

/** Stable code value (CI-19 — frozen post-Phase-5). */
export const CLINICAL_INVARIANT_ERROR_CODE = "CLINICAL_INVARIANT_VIOLATION" as const;
/** Stable reason value (CI-4, §19.6 — frozen post-Phase-5). */
export const CLINICAL_INVARIANT_ERROR_REASON = "ORPHAN_DISPENSE_BLOCKED" as const;
/** Stable cop.kind value (§19 stability matrix — frozen post-Phase-5). */
export const CLINICAL_INVARIANT_COP_KIND = "orphan_dispense" as const;
/**
 * Fixed English fallback message. **Non-contractual** — only suitable
 * for server logs / developer triage. The future UI/i18n phase may
 * replace or wrap it (CI-19 / §19.28).
 */
export const CLINICAL_INVARIANT_ERROR_MESSAGE =
  "Dispense does not match active orders for this patient/container context.";

export interface ClinicalInvariantErrorBody {
  code: typeof CLINICAL_INVARIANT_ERROR_CODE;
  reason: typeof CLINICAL_INVARIANT_ERROR_REASON;
  message: typeof CLINICAL_INVARIANT_ERROR_MESSAGE;
  requestId: string;
  clinical: true;
  cop: {
    kind: typeof CLINICAL_INVARIANT_COP_KIND;
    orphanLines: OrphanLineDetail[];
  };
}

export interface BuildClinicalInvariantErrorArgs {
  requestId: string;
  orphanLines: ReadonlyArray<OrphanLineDetail>;
}

/**
 * Phase 5 PR 5.6 — Construct the 422 response body for an
 * enforce-mode orphan-dispense denial.
 *
 * Inputs:
 *   - `requestId` — threaded from the route layer for client / log
 *     correlation. Required.
 *   - `orphanLines` — the orphan lines produced by the wired
 *     evaluator's deny verdict. Each entry's `itemId`, `quantity`,
 *     `reasons`, and `matchingOrderIds` are stable machine-readable
 *     contracts; `label` is best-effort.
 *
 * Outputs a frozen-shape envelope; consumers (PR 5.7 will be the
 * first) just `res.status(422).json(body)`.
 */
export function buildClinicalInvariantError(
  args: BuildClinicalInvariantErrorArgs,
): ClinicalInvariantErrorBody {
  // Defensive copy of orphanLines so a caller mutating the input
  // post-call cannot retroactively change the response body. The
  // `OrphanLineDetail` shape is itself a plain data type — a
  // shallow copy is sufficient (each `reasons` / `matchingOrderIds`
  // array is also defensively cloned).
  const orphanLinesCopy: OrphanLineDetail[] = args.orphanLines.map((line) => ({
    itemId: line.itemId,
    quantity: line.quantity,
    label: line.label,
    reasons: [...line.reasons],
    matchingOrderIds: [...line.matchingOrderIds],
  }));

  return {
    code: CLINICAL_INVARIANT_ERROR_CODE,
    reason: CLINICAL_INVARIANT_ERROR_REASON,
    message: CLINICAL_INVARIANT_ERROR_MESSAGE,
    requestId: args.requestId,
    clinical: true,
    cop: {
      kind: CLINICAL_INVARIANT_COP_KIND,
      orphanLines: orphanLinesCopy,
    },
  };
}
