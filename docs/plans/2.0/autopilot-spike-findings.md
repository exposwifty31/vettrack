# Autopilot Shadow Spike — Findings (Task 0.3)

> VetTrack 2.0, Task 0.3. Proves the propose→approve loop: outbox/audit events in a shift window produce
> ONE staged `action_proposal` (an auto-composed shift-handover draft) with citations; approve/edit/reject
> transitions the proposal and captures a labeled "operations-memory" record. Built via TDD (RED before
> code) in an isolated, unmerged spike branch — see §10. Independently re-verified against the actual
> worktree — see §9.

## ⚠️ Critical discovery, surfaced before the spike started

This repo already ships a **live production feature, R-SH-F1** (shift handover — commit `960106742`),
that auto-generates and auto-publishes a shift handover artifact with **no human approval gate**:
`generateShiftHandover()` (`server/lib/shift-handover-generator.ts`) computes deltas over a shift window
and immediately persists + pushes the result to the next-shift roster; `startShiftHandoverScheduler()`
runs this every 5 minutes in production (`server/lib/shift-handover-scheduler.ts`, registered in
`server/app/start-schedulers.ts`).

This directly overlaps the 2.0 vision's "first Autopilot proposal type" (session-2.md Small Gem 1:
"the copilot auto-composes the handover... Tech reviews and confirms; never writes"). The spike was
explicitly scoped to **never touch R-SH-F1's live auto-publish path** — read-only reuse of its window/delta
computation only. **The product question is open, not resolved by this spike:** does a future Autopilot
handover-proposal *replace* R-SH-F1's auto-publish (retiring the scheduler), run *alongside* it as a
separate draft-preview surface, or something else (e.g. R-SH-F1 stays the safety-net default, Autopilot
is opt-in per clinic)? **Task 1.1 needs the product owner's decision here before wiring anything real.**

## 1. Proposal-card anatomy (decided before schema was written)

Working-agreement joint-kickoff step, done before the schema was frozen. A staged proposal must carry:
summary (human-readable), cited source facts (exact outbox/audit row ids + types the summary is grounded
in — checkable), a closed kind discriminator (`shift_handover_draft`, extensible), status
(`staged | approved | edited | rejected`), who acted + when, `clinicId`. Plus, once the list was written
out: `sourceRef` (traceability back to the shift window), `draftContent` (the composed content, same
shape as R-SH-F1's `deltas`), `citationValidation` (a snapshot of the automated grounding check, so a
reviewer sees the result without re-running it). This list drove the schema below, not the reverse.

## 2. `action_proposal` schema

`server/schema/ops.ts`:
- `actionProposal` (`vt_action_proposal`), lines 599–630: `id, clinicId, kind, status, sourceSessionId,
  summary, citedFacts (jsonb), draftContent (jsonb), sourceRef (jsonb), citationValidation (jsonb),
  editedContent (jsonb, nullable), rejectionReason, decidedByUserId, decidedAt, createdAt, updatedAt`.
  Unique index `ux_vt_action_proposal_clinic_kind_session` on `(clinicId, kind, sourceSessionId)`
  enforces the idempotency contract (one staged proposal per kind per shift session).
- `actionProposalDecisionLog` (`vt_action_proposal_decision`), lines 641–663 — the append-only
  operations-memory table: one row per approve/edit/reject, snapshotting `stagedSummary`,
  `stagedCitedFacts`, `stagedDraftContent` alongside `decision`, `decidedByUserId`, `decidedAt`,
  `editedContent`, `rejectionReason`. Never updated once written.
- Types + Zod contract in `server/lib/autopilot/action-proposal-types.ts`, imported `type`-only into
  `ops.ts` (mirrors the existing `shift-handover.ts` pattern).
- Independently re-verified: `ops.ts` diff is purely additive (+99/−0); the pre-existing `eventOutbox`
  table definition inside the same file is byte-identical to base — only new tables were appended.

## 3. Closed union additions

`server/lib/audit.ts` — 4 new `AuditActionType` members appended to the union declaration itself (not
merely referenced elsewhere): `action_proposal_staged`, `action_proposal_approved`,
`action_proposal_edited`, `action_proposal_rejected`. Independently re-verified.

## 4. Server mechanism

- **Reader port:** `ShiftDeltaReader` (`server/lib/autopilot/shift-delta-reader.port.ts`) —
  `auditRows`/`outboxRows` over a `ShiftWindow`. `aggregateDeltasViaReader()` classifies raw rows via the
  now-exported `classifyDeltaKind`, producing both `ShiftHandoverDeltas` and a flat ground-truth
  `ActionProposalCitedFact[]`. `DrizzleShiftDeltaReader` is the real, typecheck-only implementation, and
  every query is `clinicId`-scoped (independently re-verified).
- **Writer port:** `ActionProposalWriter` (`server/lib/autopilot/action-proposal-writer.port.ts`) —
  `findStaged/get/stage/transition/recordDecision`. Every query is `clinicId`-scoped (independently
  re-verified); inserts (`stage`, `recordDecision`) take `clinicId` from caller-supplied input, correctly.
- **Pure composer:** `composeHandoverDraftProposal` (`server/lib/autopilot/handover-draft-composer.ts`)
  turns `ShiftHandoverDeltas` into a `NewActionProposalInput` — no I/O.
- **Service:** `composeAndStageHandoverDraft` / `approveProposal` / `editProposal` / `rejectProposal`
  (`server/lib/autopilot/action-proposal-service.ts`).
- **Reuse:** one keyword — `export` added to `aggregateDeltas`
  (`server/lib/shift-handover-generator.ts:189`) — independently re-verified as the file's *entire* diff,
  zero behavior change. The production worker
  (`server/workers/autopilotHandoverDraftWorker.ts`) calls `resolveShiftWindow` + this real
  `aggregateDeltas` directly — literal reuse, exact behavioral fidelity with R-SH-F1. The test suite drives
  the same classification rule (`classifyDeltaKind`, already public) through the injectable
  `ShiftDeltaReader` port instead, to avoid needing a live Postgres connection — a legitimate second entry
  point into the same classification logic, not a duplicate reimplementation of it.

## 5. Citation-grounding proof — a parallel validator, not literal reuse (flagged deviation)

**The original task asked to wire proposal citations through the existing
`validateCitation`/`validateCopilotAnswer`** (`server/domain/equipment/copilot/citation-validator.ts`) and
`validateCopilotAnswerSafety` (`ai-safety-validator.ts`). **The spike did not do this — it built a
structurally parallel validator instead** (`server/lib/autopilot/action-proposal-citation-validator.ts`,
same `{valid}` result shape). This is a genuine, disclosed deviation from the literal instruction, not a
hidden shortcut — independently investigated and found to have a real underlying cause:

- `CitationType` (`shared/contracts/asset-copilot.v1.ts`) is a closed 10-member union
  (`equipment | rfid | scan | transfer | sse | waitlist | condition | room | dock | staging`) — no member
  represents an outbox/audit-log fact. Independently confirmed accurate.
- `EvidenceGraph`/`citationExistsInGraph` (`citation-validator.ts`) are scoped to **one equipment's**
  evidence (rfid reads, scans, transfers, rooms, staging for a single `equipmentId`) — no field could hold
  outbox/audit rows spanning many entities across a shift window. Independently confirmed accurate.
- `ai-safety-validator.ts` hardcodes a second, independently-maintained closed allow-list (narrower than
  `CitationType` — missing `"sse"`). Independently confirmed accurate.

**Independent reviewer's own assessment (not the spike's self-justification):** the type mismatch is real.
Making the existing validator accept outbox facts would require either fabricating a per-request
`EvidenceGraph` under a fake `equipmentId` (exactly the kind of evidence misrepresentation the existing
docstring warns against) or widening `EvidenceGraph`'s shape to serve two structurally different domains
(single-asset evidence vs. shift-window fact stream) — itself a design compromise, not a clean extension.
Writing a parallel validator was judged a **defensible spike-stage call**, correctly disclosed rather than
concealed. **One overstatement to correct:** the new validator's file docstring calls the `CitationType`
union "FROZEN" — but `shared/contracts/asset-copilot.v1.ts` is **not** one of the 9 surfaces CLAUDE.md
actually designates as frozen. The underlying caution (don't casually widen a versioned wire contract used
elsewhere) is reasonable, but it's a self-imposed rule, not a documented project invariant — Task 1.1
should treat widening `CitationType` additively as a genuinely open option, not a forbidden one.

Tests (`tests/autopilot-spike.test.ts`, "citation grounding" block): a proposal whose citations are
exactly the reader's ground-truth rows validates `{valid:true}`; a citation with a fabricated `sourceId`
not present in ground truth is flagged (`citation_not_grounded:...`), while the untampered set alongside it
still passes independently.

**Self-consistency caveat (from the spike's own §8, worth restating here):** the current grounding check is
self-consistent-by-construction — citations are validated against a ground truth derived from the *same*
deltas that produced them. A real anti-hallucination gate needs citations from an actually independent
source (e.g. an LLM-drafted summary) checked against the DB-derived ground truth, not two derivations of
the same input.

## 6. Approve/edit/reject + labeled-data capture

Tests (`tests/autopilot-spike.test.ts`, "approve/edit/reject" block) prove:
- Status transitions `staged → approved/edited/rejected` exactly once — `transition()` in the writer port
  guards with `status === "staged"` in its match predicate and throws on a second decision attempt.
  Independently re-verified as a real guard, not a happy-path-only test: the test approves a proposal,
  then attempts `rejectProposal` on the same id, asserts it throws, **and** asserts the decision log still
  has length 1 (the failed second decision did not append a duplicate operations-memory row).
- Each decision appends one row to `actionProposalDecisionLog`, snapshotting the staged
  summary/citedFacts/draftContent plus the decision (and, for edit, the edited content; for reject, the
  reason).
- `logAudit` is called with `action_proposal_approved` / `action_proposal_edited` /
  `action_proposal_rejected` respectively, target = the proposal id.

## 7. Every seam Task 1.1 must build through

1. **Resolve the R-SH-F1 overlap decision** (see the ⚠️ box above) with the product owner before any real
   wiring — this is the single biggest open question.
2. **The other 3 roadmap proposal kinds** (coordinator-reassign-when-off-roster, restock-PO-on-burn,
   crash-cart-drift pull-back) each need their own content source, the way `shift_handover_draft` uses
   `resolveShiftWindow` + `aggregateDeltas` — none of that exists yet.
3. **A real approval-queue UI** — this spike ships zero frontend (design scope from the roadmap's Task 1.1
   entry: the "lead's home screen" queue, citation-grounded "why", `aria-live`, mobile+console+board).
4. **Mount the route for real** — `server/routes/action-proposals.ts` exists and typechecks but is
   deliberately left unmounted in `server/app/routes.ts` (kept the spike's diff-stat to exactly the
   sanctioned touch list). Needs real request-body validation beyond the spike's minimal checks.
5. **A per-org policy gate before any `enforce`** — mirror the existing `off | shadow | enforce`
   enforcement envelope (already proven on the authority evaluators) rather than inventing a new one, per
   Task 0.4.
6. **Resolve the citation-validator fork** (§5) — widen `CitationType` additively to unify the two
   validators, or keep them intentionally separate (equipment-state grounding vs.
   operational-fact-stream grounding may genuinely be different domains). Not decided by this spike.
7. **A real anti-hallucination gate** — see the self-consistency caveat in §5. Citations need to come from
   an independently-derived draft (e.g. LLM-composed) checked against DB ground truth, not two derivations
   of the same computed deltas.
8. **i18n** — the spike's `summarizeDeltas` produces a hardcoded English string; production copy must go
   through `locales/{en,he}.json` via the typed `t.*` accessor, per repo convention.
9. **Migration SQL** — not generated in the spike environment (see §9 environmental note); Task 1.1 needs
   to generate it through a working `drizzle-kit generate` environment or hand-author matching the
   `migrations/` conventions.

## 8. Design-thread review needed

Per the working agreement, this spike's card anatomy (§1) and citation-grounding UX implications (§5) need
design review before Task 1.1's schema/UI work proceeds — same checkpoint pattern as Task 0.1.

## 9. Verification evidence

**Self-reported, then independently re-verified from a fresh context against the actual worktree**
(re-ran every command; did not trust the implementer's report):

- `pnpm exec tsc --noEmit` (frontend) — **0 errors.** Independently re-run, confirmed with real exit code.
- `pnpm exec tsc -p tsconfig.server.json --noEmit` (server) — **0 errors.** Independently re-run, confirmed.
- `pnpm exec vitest run tests/autopilot-spike.test.ts` — **9/9 passed.** Independently re-run, exact match.
- `git diff --stat a428cba42..HEAD` — **14 files changed, 1650 insertions(+), 2 deletions(-).**
  Independently re-run, exact match on file list and totals. Per-file: `shift-handover-generator.ts` +1/−1
  ✓, `start-schedulers.ts` +5/−0 ✓, `ops.ts` +99/−0 (purely additive) ✓. **One correction from the
  independent review:** `audit.ts` is actually **+6/−1**, not the originally-reported +7/−1 (the report
  conflated the diff-stat bar's total-touched-lines figure with the insertions count) — immaterial to
  substance, corrected here.
- **Frozen-surface check** — independently re-verified zero diff on `server/lib/shift-handover-scheduler.ts`,
  `server/lib/realtime-outbox.ts`, `server/lib/event-publisher.ts`, `package.json`; no Code Blue or
  `vt_appointments`/`schema/tasks.ts` file touched; the `eventOutbox`/`vt_event_outbox` table definition
  inside `ops.ts` confirmed byte-identical to base (new tables only appended after it).
- **Multi-tenancy check** — independently re-read every query in the writer/reader ports and confirmed
  `clinicId`-scoped throughout. One note carried forward: the test-only `InMemoryShiftDeltaReader` fake
  does not itself filter by `clinicId` (harmless — a unit-test double, not production code — but not
  itself proof of tenant isolation; the real `DrizzleShiftDeltaReader` is what was checked and confirmed
  scoped).
- **Environmental note (not a regression):** `shift-handover-generator.test.ts` and
  `shift-handover-patient-worklist.test.ts` fail in the spike worktree with
  `database "vettrack_test" does not exist` — a pre-existing environment gap (that DB was never
  provisioned in this worktree), not caused by the spike's changes; the spike's only touch to
  `shift-handover-generator.ts` is the single `export` keyword, and a closed-union addition in `audit.ts`
  cannot break existing comparisons. `drizzle-kit generate` also failed on a pre-existing ESM/CJS
  module-resolution issue in `schema/index.ts` unrelated to the spike's own schema additions (same failure
  mode independently observed during the Task 0.2 spike).

## 10. Spike branch (unmerged — do not merge)

`worktree-agent-a64779cdd0617e6ff`, commit `951aa8f9e`
(built in an isolated git worktree at `/Users/dan/vettrack/.claude/worktrees/agent-a64779cdd0617e6ff`,
branched from `a428cba42`). Not pushed, no PR opened. Learning artifact only — Task 1.1 reads this
findings document; it does not build on top of the spike branch's commits.
