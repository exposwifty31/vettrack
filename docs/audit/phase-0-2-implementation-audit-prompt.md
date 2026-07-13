# Audit Prompt — Consolidated Audit × 10x, Phases 0–2 Implementation

> Hand this to a fresh auditing agent. It is a **report-only** post-merge audit of the code that shipped in **PR #86** (merge commit `b6856f921`, branch `executing-audit-10x-consolidated-plan` → `main`). No code changes. The auditor's job is to independently re-verify that what the ledger claims shipped actually shipped, is correct, and did not weaken a frozen surface — **not** to trust the self-reported "complete / green" record.

---

## Role

You are a skeptical senior engineer performing an independent post-merge audit. You did not write this code and you do not trust the implementer's own notes. A claim is "complete" only when you have read the actual merged code, the actual test, and confirmed the behavior yourself. The self-report (`.superpowers/sdd/progress.md`, `docs/audit/PROOF_ALIGNMENT_LOG.md`) tells you *what to check*, never *that it passed*. Your default posture: every card is UNVERIFIED until you prove otherwise from the diff.

## What shipped (scope of this audit)

The "Consolidated Audit × 10x" remediation, **Phases 0–2 only**, merged in PR #86:

- **Phase 0A** — `T-01…T-05`: five HIGH stabilization fixes.
- **Phase 0B** — `T-06…T-16`: the App Store owner submission-gate checklist (a deliverable doc, not code).
- **Phase 1** — `T-17…T-33`: equipment fixes + locate / readiness-badge / damaged-at-check-in; shift-chat; start-of-shift; inventory + the compute-on-read nudge feed; the web management-gate.
- **Phase 2-fixes** — `T-34…T-44`: eleven native-reachable MED-sweep fixes, including the two frozen PWA cards (sync-status-banner `T-36`, sw-update-banner `T-37`).
- **Owner escalation decision (2026-07-13):** "Returned damaged" **must also release custody** (overrode the prior spec-compliant behavior).

**Explicitly OUT of scope** (parked per the "stop after Phase 2" directive — do not audit): R-CB-stabilize sub-spec, Phase 3 (`T-45…T-53`), the O+R feature sub-specs (`docs/plans/consolidated-audit-10x/subspecs/`), Phase 4.

## Authoritative inputs (read these first, in this order)

1. **Design spec (source of truth for intent):** `docs/superpowers/specs/2026-07-12-audit-10x-consolidated-plan-design.md`
2. **Plan cards:** `docs/plans/consolidated-audit-10x/phase-0-1.plan.md` and `phase-2-3.plan.md` (Phase 2 half only). Also `README.md` and `IMPLEMENTATION-REFINEMENTS.md` in that dir.
3. **Implementer's ledger (the card list + claims to re-verify):** `.superpowers/sdd/progress.md`
4. **Proof log (per-card self-reported evidence):** `docs/audit/PROOF_ALIGNMENT_LOG.md` — 441 KB; do **not** read whole. Grep for the specific `T-NN` you are checking and read only that block.
5. **Frozen-surface contract:** the "Frozen architecture surfaces" and "Operational doctrine (what NOT to do)" sections of `CLAUDE.md`. These are load-bearing invariants; a card that weakens one is a CRITICAL finding regardless of whether tests pass.

Build the **authoritative card inventory** by reconciling (2) the plan cards against (3) the ledger's `complete` lines. Any card in the plan that the ledger does not mark complete, and any card the ledger marks complete that has no corresponding merged diff, is itself a finding.

## Method (mandatory — this is what makes it an audit, not a re-read)

1. **Fetch first.** `git fetch origin`. Establish the exact merged tree: `git show -s b6856f921` and diff the tranche with `git diff <merge-base>...b6856f921 --stat`. If `b6856f921` is not reachable, locate the actual PR #86 merge on `origin/main` (`gh pr view 86 --json mergeCommit,mergedAt`) and use that. Record the SHA you actually audited in the report header.
2. **Per card, trace to real code.** For each `T-NN`: open the files it touched, read the handler/query/component end-to-end, and confirm the *behavior the spec demanded* is present — not merely that a function with the right name exists.
3. **Read the test, don't trust the checkmark.** For every card that claims a RED-then-GREEN test: open the test file and confirm it asserts *behavior* (real inputs → real outputs), not a mock's call count or a tautology. A test that would still pass if the fix were reverted is a defect (report it as `test-teeth`, HIGH). Where cheap, actually run the named test.
4. **Adversarially verify every CRITICAL/HIGH before reporting it.** Re-read the code independently and try to *refute* your own finding: does an effect restore the state, is the value re-derived, does a guard already cover it, is the endpoint real? Only findings that survive a genuine refutation attempt go in the main report; the rest go to a REFUTED appendix with the reason.
5. **No silent gaps.** If you could not verify a card (missing context, spans unchanged code, needs a live app), list it as `CANNOT-VERIFY` with the reason. Never let an unchecked card read as "passed."

## Audit dimensions (apply each to every relevant card)

- **Spec compliance** — does the merged behavior match what the spec/plan card required? Over-build (unrequested surface) and under-build (missing requirement) are both findings.
- **Frozen-surface preservation** — did any card touch SSE realtime, the offline-emergency block (`src/lib/offline-emergency-block.ts`), server-confirmed Code Blue end, the bounded-enum telemetry, Strategy A authority fallback, the emergency cache denylist, the `appointmentsPage.*` key namespace, or the `AuditActionType` union? If so, prove it *extended additively* and did not weaken the contract. This is the highest-severity dimension.
- **Multi-tenancy** — every new/changed DB query filters by `clinicId`. Pay special attention to the new routes/services: `server/routes/nudges.ts`, `server/services/nudge-feed.service.ts`, `server/routes/equipment-damage.ts`, `server/routes/equipment-locate.ts`.
- **Behavioral correctness (click-path patterns)** — on new/changed handlers, trace for: Sequential Undo (two mutations that cancel each other), stale closure, async race, Missing Transition (a button that never performs its promised action), dead conditional branch, `useEffect` interference. Prime target: the custody-release path in `src/pages/equipment-detail.tsx` (the "Returned damaged" branch — does it release custody *and* defer the damage report, and does the offline branch avoid firing an online-only damage report?).
- **i18n** — new user-facing copy has `en`/`he` parity (`pnpm i18n:check`), is reached through the typed accessor in `src/lib/i18n.ts`, and no hardcoded Hebrew leaked into `.ts`/`.tsx`. New API-error routes that bypass `apiError()` must be justified (check the `KNOWN_DEBT_ALLOWLIST` entries added for the new routes — are they legitimately consistent with their equipment-family siblings, or a real i18n regression?).
- **Migration safety** — `migrations/162_vt_damage_events.sql` (and any other new migration): lock-safe on a populated table (e.g. `CHECK ... NOT VALID` rather than a blocking validate), idempotent, `clinicId` present, and honest about the absence of a down-migration path.
- **Deliverable existence** — Phase 0B is a doc. Confirm `docs/audit/phase-0b-owner-checklist.md` (or whatever the ledger names) actually exists in the merged tree and covers `T-06…T-16`. A ledger "complete" with no file is a finding.
- **Deferred-item legitimacy** — the CodeRabbit loop was terminated by severity-gating, with a residual tail logged as backlog and **5 "Major" threads dismissed as non-blocking**. Independently re-examine those dismissals (find them via `gh pr view 86 --comments` / the review threads): were they genuinely cosmetic/carryover-already-fixed, or was a real defect waved through? Re-open any that were misclassified as a finding.

## Output format

Write `docs/audit/phase-0-2-implementation-audit-<YYYY-MM-DD>.md` following the conventions of the existing `docs/audit/*.md` reports. Structure:

- **Header:** audited SHA, fetch timestamp, method (independent post-merge, adversarially verified), scope (Phases 0–2, `T-01…T-44`), out-of-scope list.
- **Findings**, severity-ranked, each:
  - `AUDIT-0-2-NNN` · severity `CRITICAL | HIGH | MEDIUM | LOW`
  - Card(s): `T-NN` · Dimension · File:line
  - Claim (what the ledger/spec said) → Actual (what the code does) → Failure scenario (concrete inputs → wrong result)
  - Verdict: `CONFIRMED` (survived refutation) or `PLAUSIBLE`; Suggested fix (one line, no code changes this round)
- **Coverage table:** every card `T-01…T-44` → `CONFIRMED-CORRECT | DEFECT (finding id) | CANNOT-VERIFY (reason)`. No card omitted.
- **REFUTED appendix:** findings you disproved during adversarial verification, with the refutation.
- **Frozen-surface attestation:** an explicit per-surface line ("SSE: untouched", "offline-emergency-block: extended additively at L…, contract intact", …) so a reader sees the invariants were checked, not skipped.

Then append one `PROOF_ALIGNMENT_LOG.md` entry (claim: audit executed over `T-01…T-44`; evidence: audited SHA, report path, coverage counts, finding counts by severity).

## Constraints (what NOT to do)

- **No code changes.** Report only. Fixes are a separate follow-up task after the human reviews this report.
- **Do not trust the ledger or proof log as proof of correctness** — they are the checklist, not the verdict.
- **Do not audit out-of-scope work** (Phase 3, sub-specs, Phase 4).
- **Do not report a CRITICAL/HIGH you did not adversarially verify.** Unverified suspicions go to `CANNOT-VERIFY`, not the main report.
- **Do not run the dev server or do live-browser checks** this round (static + test-run only). Flag anything that genuinely needs live verification as `CANNOT-VERIFY (needs live app)`.
- **`git add` only the two report files** (the audit report + the proof-log append) if you commit; never `git add -A`.

## Worked example finding (format + rigor bar)

```
AUDIT-0-2-014 · HIGH · test-teeth
Card: T-36 (sync-status-banner) · Dimension: TDD authenticity
File: tests/sync-status-banner.test.tsx:42
Claim: "RED reproduced the signature collision; fix folds clientMutationId into the dismissal key."
Actual: The test asserts the Set has size 2 after two dismissals, but never asserts that a THIRD
        banner with a distinct clientMutationId still renders — the exact collision the fix targets.
        Reverting the clientMutationId fold leaves this test green.
Failure scenario: two errors sharing (syncErrorKind, targetResource) but differing clientMutationId;
        dismissing one silently dismisses the other; test does not catch it.
Verdict: CONFIRMED (re-read the fixture; no other assertion covers the third-signature case).
Suggested fix: add an assertion that a third, distinct-clientMutationId banner remains visible.
```

That is the bar: a named failure scenario, a revert-would-still-pass argument for test findings, and a verdict that survived a refutation attempt. A finding without a concrete failure scenario is not ready to report.

---

### Scaling to parallel agents (optional)

If dispatched as a multi-agent workflow, shard by phase into 3 waves so a partial run is still reportable, highest-risk first — **Wave 1:** frozen-surface + custody + Phase 2 PWA cards (`T-34…T-44`); **Wave 2:** Phase 1 equipment/locate/nudge/inventory (`T-17…T-33`); **Wave 3:** Phase 0 stabilization + owner-checklist deliverable (`T-01…T-16`). Give each shard this same prompt scoped to its card range, run the adversarial-verify stage per finding, then the main loop assembles the single report + coverage table. Recommended tiers: mid-tier model for the finders, most-capable for the adversarial verifiers on CRITICAL/HIGH.
