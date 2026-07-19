# Task 1.1 — Shift Autopilot, `shadow` mode — Execution Plan

> **§0 RESOLVED — owner decision 2026-07-19: option (c), per-org policy gate.** R-SH-F1's auto-publish
> stays untouched by default for every clinic; retiring it for a given clinic is gated behind Task 0.4's
> `off | shadow | enforce` + per-org-policy pattern, so a clinic's admin explicitly opts in when ready.
> This pulls Task 0.4's policy-layer wiring into 1.1's `shift_handover_draft` slice earlier than its
> original Task 2.5(a) slot (see §0(c) below for the mechanism and §2 for how it binds to the retirement
> switch). All four proposal-type slices in this plan may now proceed, `shift_handover_draft` included.

> VetTrack 2.0, Task 1.1, Execute step 1 (`docs/vettrack-2.0-roadmap.md` lines 233–249). This is the
> **planning** deliverable only — no code in this doc. Task 1.1's Execute steps 2–3 (TDD build, one
> proposal type per PR-sized slice, screenshots) are separate future dispatches that read this plan.
>
> Grounded in: `docs/plans/2.0/autopilot-spike-findings.md` (Task 0.3), `docs/design/autopilot-policy-layer.md`
> (Task 0.4), `docs/plans/2.0/autopilot-backtest.md` (Task 0.5 — synthetic numbers only, not cited for
> real thresholds here), `server/lib/shift-handover-generator.ts` / `server/lib/shift-handover-scheduler.ts`
> (R-SH-F1, live), and CLAUDE.md's Frozen architecture surfaces + Operational doctrine.
>
> **Repo-state correction vs. the spike doc:** the Task 0.3 spike was built and independently verified in
> an **isolated, unmerged worktree branch** (`worktree-agent-a64779cdd0617e6ff`, commit `951aa8f9e`).
> That commit is **not an ancestor of `main`** (confirmed: `git merge-base --is-ancestor 951aa8f9e HEAD` →
> not an ancestor; `server/lib/autopilot/`, `server/routes/action-proposals.ts`, the `vt_action_proposal`
> tables, and the 4 new `AuditActionType` members do **not exist** anywhere in this branch's `server/`
> tree). Task 1.1's execution therefore **recreates** this surface from scratch in this branch, using the
> spike findings as the proven design reference (file:line citations below point at the spike commit for
> design fidelity, not at files present in this working tree).

---

## §0 — RESOLVED (owner sign-off obtained 2026-07-19)

**Mechanism: option (c), per-org policy gate.** R-SH-F1 stays untouched by default for every clinic;
retiring it for a given clinic is gated behind Task 0.4's `off | shadow | enforce` + per-org-policy
pattern (`autopilot.policy_enforce.shift_handover_draft.<clinicId>` flipped to `approved` by that clinic's
admin, per §0(c) below), so a clinic opts in explicitly rather than a single global cutover.

**Fallback sub-question, also resolved: auto-publish-on-timeout.** For an opted-in clinic, if a staged
`shift_handover_draft` proposal is still unapproved N minutes after shift end, it auto-publishes
automatically (same content R-SH-F1 would have produced) and the decision-log/audit row is marked
`auto_published_on_timeout` (a distinct, honest label — never silently indistinguishable from a real human
approval). This is a rare safety-net path, not the default: continuity of care never breaks, but every
timeout-fallback event is visible in the audit trail as unreviewed. `N` (the timeout minutes) is a
per-clinic-configurable value alongside the policy flag, not a hardcoded constant — the §2 implementation
slice must pick a sensible default and expose it through the same admin console surface as the opt-in
toggle.

The remainder of this section is kept as the historical record of the tradeoffs considered.

## §0 (historical) — Open rollout-safety question (requires owner sign-off before the `shift_handover_draft` proposal type ships)

**Binding decision already made (2026-07-19):** Autopilot **replaces** R-SH-F1's auto-publish path.
`startShiftHandoverScheduler()` (`server/lib/shift-handover-scheduler.ts:56`, registered in
`server/app/start-schedulers.ts`) is to be retired; every shift handover becomes a staged
`action_proposal` (kind `shift_handover_draft`) requiring tech approval before the next shift sees it.

**What is NOT decided, and must not be decided unilaterally by whoever executes this plan:** *how* the
cutover happens. Today, `scanEndedShiftsForHandover()` (`server/lib/shift-handover-scheduler.ts:23`) runs
every 5 minutes and **guarantees** a handover reaches the next shift — no human in the loop, no failure
mode where nothing happens. After this change, a human must actively approve a staged proposal, or by
construction **nothing publishes**. For a hospital, a missed or delayed handover is a real
continuity-of-care risk (an open task, an unresolved alert, a still-dispensing item silently not
communicated to the incoming shift). This is a production behavior change for clinic staff, not an
engineering-only shadow test, even though the roadmap labels Task 1.1 "shadow mode."

Three options, with honest tradeoffs. **This plan does not pick one.** The proposal-type's implementation
slice (§2 below) must not begin until the owner has signed off on one of these (or an owner-specified
variant):

### (a) Hard cutover
Retire `startShiftHandoverScheduler()`'s call site in `server/app/start-schedulers.ts` the moment the
approval-queue UI (§1.4) ships. Define an explicit fallback for "nobody approved within N minutes of shift
end" — and that fallback itself needs a decision: auto-publish the draft anyway (reintroduces the exact
silent-auto-publish behavior Autopilot exists to remove, just delayed by N minutes), escalate to a
second person (who — the incoming shift's senior tech? the outgoing shift's coordinator?), or page/alert
an admin. **Tradeoff:** simplest to build and reason about (one code path, no dual-running window), but
the failure mode is a hard product decision hiding inside what looks like an engineering default, and it
ships with zero real-world proof that clinics will actually approve promptly.

### (b) Parallel-run window
Keep `startShiftHandoverScheduler()` running unchanged as the safety net for a defined window (days or
weeks) while the approval flow proves itself in production — every shift end produces *both* the
auto-published R-SH-F1 artifact (unchanged, current behavior) *and* a staged `shift_handover_draft`
proposal that techs can practice approving without consequence if they miss it. **Requires a graduation
criterion** decided up front: e.g. "N consecutive real shifts approved within M minutes of shift end,
across at least 2 clinics" before the scheduler is actually retired. **Tradeoff:** materially safer (never
a moment with zero safety net), gives real approval-latency data to size option (a)'s fallback timer with,
but means the `shift_handover_draft` proposal is initially *informational only* (a preview, not "the"
handover) for the length of the window, so the "replaces R-SH-F1" decision doesn't take effect until the
graduation criterion fires — the owner may not want that delay.

### (c) Gate the retirement itself through the existing `off | shadow | enforce` + per-org-policy pattern (Task 0.4)
Instead of a single global cutover, treat "does this clinic's handover leave R-SH-F1's auto-publish path
and move to approval-gated Autopilot" as its own per-clinic policy switch, reusing exactly the mechanism
Task 0.4 designed for `enforce` promotion (`vt_server_config` key + closed audit kinds + admin-only
console ceremony). Concretely: a clinic stays on R-SH-F1's unconditional auto-publish until its admin
explicitly flips `autopilot.policy_enforce.shift_handover_draft.<clinicId>` to `approved` **and** the base
proposal-mode family for `shift_handover_draft` is at `enforce` for that clinic — at that point (and only
that point) does `scanEndedShiftsForHandover` skip that clinic and the approval queue become load-bearing
for it. **Tradeoff:** this is the option most consistent with the codebase's own safety doctrine (mirrors
the fail-toward-least-harmful-state principle in `docs/design/autopilot-policy-layer.md` §6) and gives
each clinic its own opt-in moment with its own audit trail — but it means `shift_handover_draft` is the
*first* proposal kind to need the Task 0.4 policy layer wired end-to-end during Task 1.1 (originally
scoped as Task 2.5(a)'s job), pulling that work earlier than planned, and it still needs its own answer to
"what happens if a clinic is mid-cutover and nobody approves" (the same open sub-question as (a), just
scoped per-clinic instead of globally).

**RESOLVED — see the top of §0 above.** Owner chose (c), with the fallback sub-question resolved as
auto-publish-on-timeout (labeled distinctly in the audit trail, never conflated with a real approval).
This historical paragraph is kept for context only. **Gate (satisfied):** whoever executes §2 (`shift_handover_draft`) must have a recorded owner decision on (a) /
(b) / (c) / other, including the fallback-behavior sub-question, before writing the worker that actually
stops auto-publishing anything. The other three proposal types (§3–§5) have no such predecessor to retire
and are not gated by this section — they may proceed independently.

---

## §1 — Shared infrastructure (built once, consumed by all 4 proposal types)

### §1.1 Schema — `server/schema/ops.ts`

Recreate the spike's two tables (spike design: commit `951aa8f9e`, `server/schema/ops.ts` lines 599–663 in
that commit — not present in this tree). Append after the existing `eventOutbox` table definition
(currently the last export in `server/schema/ops.ts` in this tree — confirm the actual end-of-file anchor
at execution time since other Phase-0/1 work may have appended tables since this plan was written).

```ts
export const actionProposalKind = pgEnum("vt_action_proposal_kind", [
  "shift_handover_draft",
  "coordinator_reassign_off_roster",
  "restock_po_on_burn",
  "crash_cart_drift",
]);
export const actionProposalStatus = pgEnum("vt_action_proposal_status", [
  "staged", "approved", "edited", "rejected",
]);

export const actionProposal = vtTable(
  "vt_action_proposal",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    kind: actionProposalKind("kind").notNull(),
    status: actionProposalStatus("status").notNull().default("staged"),
    sourceSessionId: text("source_session_id").notNull(),
    summary: text("summary").notNull(),
    citedFacts: jsonb("cited_facts").notNull().$type<ActionProposalCitedFact[]>(),
    draftContent: jsonb("draft_content").notNull(),
    sourceRef: jsonb("source_ref").notNull(),
    citationValidation: jsonb("citation_validation").notNull(),
    editedContent: jsonb("edited_content"),
    rejectionReason: text("rejection_reason"),
    decidedByUserId: text("decided_by_user_id").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    clinicKindSessionUq: uniqueIndex("ux_vt_action_proposal_clinic_kind_session")
      .on(t.clinicId, t.kind, t.sourceSessionId),
    clinicStatusIdx: index("idx_vt_action_proposal_clinic_status").on(t.clinicId, t.status),
  }),
);

export const actionProposalDecisionLog = vtTable(
  "vt_action_proposal_decision",
  {
    id: text("id").primaryKey(),
    proposalId: text("proposal_id").notNull().references(() => actionProposal.id, { onDelete: "restrict" }),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    stagedSummary: text("staged_summary").notNull(),
    stagedCitedFacts: jsonb("staged_cited_facts").notNull(),
    stagedDraftContent: jsonb("staged_draft_content").notNull(),
    decision: actionProposalStatus("decision").notNull(),
    decidedByUserId: text("decided_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
    editedContent: jsonb("edited_content"),
    rejectionReason: text("rejection_reason"),
  },
  (t) => ({
    proposalIdx: index("idx_vt_action_proposal_decision_proposal").on(t.proposalId),
    clinicIdx: index("idx_vt_action_proposal_decision_clinic").on(t.clinicId),
  }),
);
export type ActionProposalRow = typeof actionProposal.$inferSelect;
export type ActionProposalDecisionRow = typeof actionProposalDecisionLog.$inferSelect;
```

One deviation from the spike worth deciding at execution time, not silently copying: the spike used a
single open-ended `kind: text` column; this plan proposes a closed `pgEnum` (`vt_action_proposal_kind`)
since Task 1.1 now knows all 4 kinds up front, matching the codebase's general preference for DB-level
closed enums over free text where the domain is bounded (e.g. `poStatusEnum`, `codeBlueSessionStatus`
narrowing via `$type`). If execution prefers the spike's plain-text `kind` (cheaper to extend without a
migration later), that is an acceptable, disclosed deviation — do not silently pick one over the other,
note the choice in the PR description.

**Migration:** `npx drizzle-kit generate` after the schema edit; commit the generated SQL under
`migrations/`. The spike's own environment could not run `drizzle-kit generate` (pre-existing ESM/CJS
`schema/index.ts` resolution issue, per spike findings §9/§7.9) — verify this still reproduces at
execution time; if so, hand-author the migration SQL matching the numbered-file convention in
`migrations/` and cross-check column-for-column against the Drizzle schema before committing.

### §1.2 Types + Zod contracts — `server/lib/autopilot/action-proposal-types.ts`

New file. `ActionProposalCitedFact` (a flat `{ sourceId: string; sourceTable: "vt_audit_logs" |
"vt_event_outbox" | <table-per-kind, extended in §3–§5>; kind: string; at: string }` shape per the spike's
citation-grounding design), `NewActionProposalInput`, Zod schemas for the approve/edit/reject route bodies.
Imported `type`-only into `server/schema/ops.ts` (mirrors the existing pattern:
`server/schema/ops.ts` already imports `type`-only from `server/lib/shift-handover.ts` for
`ShiftHandoverDeltas` et al. — same import shape, new source file).

### §1.3 Ports + services — `server/lib/autopilot/`

Recreate per spike design (all new files in this tree):

- `shift-delta-reader.port.ts` — `ShiftDeltaReader` interface (`auditRows`/`outboxRows` over a
  `ShiftWindow`), `DrizzleShiftDeltaReader` (real, `clinicId`-scoped every query), `InMemoryShiftDeltaReader`
  (test fake). **Kind-specific note:** this port name and shape is handover-specific (window + audit/outbox
  rows). §3–§5 each need their *own* reader port with a shape matching their own content source — do not
  force restock/crash-cart/coordinator data through a "shift window of audit rows" abstraction that doesn't
  fit them; name each port after its domain (e.g. `RestockBurnReader`, `CrashCartDriftReader`,
  `CoordinatorRosterReader` — see §3–§5).
- `action-proposal-writer.port.ts` — `ActionProposalWriter` (`findStaged/get/stage/transition/
  recordDecision`), shared across all 4 kinds unchanged (the writer is kind-agnostic — it operates on the
  common `actionProposal`/`actionProposalDecisionLog` tables). Every query `clinicId`-scoped.
- `action-proposal-service.ts` — `stageProposal` / `approveProposal` / `editProposal` / `rejectProposal`,
  shared across kinds. `transition()` guards `status === "staged"` before allowing a decision (spike's
  proven single-decision-only invariant — re-verify with the same "approve then attempt reject on same id
  throws, decision log stays length 1" test shape, generalized to run once per kind).
- Per-kind pure composers, one file per kind (§2–§5): turn kind-specific source data into a
  `NewActionProposalInput`. No I/O in these files (mirrors `handover-draft-composer.ts`'s pattern).

### §1.4 Citation-validator obligations (shared across all 4 kinds)

Recreate `action-proposal-citation-validator.ts` (spike's disclosed parallel-validator deviation, findings
§5) — do **not** force these facts through `validateCitation`/`citationExistsInGraph`
(`server/domain/equipment/copilot/citation-validator.ts`), confirmed still structurally single-equipment
-scoped (`EvidenceGraph`'s fields are all keyed to one `equipmentId}` — re-read at execution time to
confirm no shape change). Confirmed: `CitationType`
(`shared/contracts/asset-copilot.v1.ts`, a closed union currently
`equipment | rfid | scan | transfer | sse | waitlist | condition | room | dock | staging`) is **not** one
of CLAUDE.md's designated frozen surfaces — widening it additively (e.g. adding an `"outbox_fact"` or
per-kind members) remains a genuinely open option for whoever resolves the spike's §7.6 fork, not a
forbidden one. This plan does not resolve that fork either way; it is out of scope for shipping shadow
mode and does not block it — the parallel validator works standalone.

**Per-kind obligation:** every proposal's `citedFacts` must be independently checkable against the *same*
kind-specific reader port's ground truth (§1.3) — i.e. §3's coordinator-reassign citations are checked
against `CoordinatorRosterReader`'s output, §4's restock citations against `RestockBurnReader`'s, §5's
crash-cart citations against `CrashCartDriftReader`'s — never cross-validated against a different kind's
source. Each kind needs its own test proving "real citations validate true; a fabricated `sourceId` is
flagged," mirroring the spike's `tests/autopilot-spike.test.ts` "citation grounding" block.

**Self-consistency caveat carried forward from the spike (§7.7):** for all 4 kinds in shadow mode, the
grounding check remains self-consistent-by-construction (citations checked against the same computed
source data that produced them) — this is acceptable for shadow mode (it proves "did we cite what we used"
not "is the underlying reasoning correct") but is **not** a real anti-hallucination gate. That gate
requires an independently-derived draft (e.g. LLM-composed summary) checked against DB ground truth — out
of scope for Task 1.1, tracked as a Task 1.1 follow-up, not silently declared solved.

### §1.5 Realtime — Socket.io advisory channel (confirmed real, R-RTC-1)

Confirmed via grep: `server/lib/realtime-collab/server.ts` (Socket.io server, path `/collab-ws`, distinct
from SSE), `server/lib/realtime-collab/rooms.ts` (room-name helpers: `chatRoom`, `boardRoom`,
`recordRoom`), `server/lib/realtime-collab/config.ts` (isolation/rate-limit config),
`src/lib/collab-socket.ts` + `src/features/collab/useCollabRoom.ts` (client side). This channel is
explicitly documented as **ephemeral-only** (presence, typing, cursors) — "It NEVER carries domain or
emergency state" (`server/lib/realtime-collab/server.ts:1-9`).

**A staged/approved/edited/rejected `action_proposal` is domain state, not ephemeral presence** — so this
plan does **not** propose piping proposal-queue updates through the existing `chatRoom`/`boardRoom`/
`recordRoom` shapes as-is; those rooms' whole design contract is "never domain state." Two honest options,
to decide at execution time (not silently defaulted):

1. **Add a new room shape** to `rooms.ts` — e.g. `proposalQueueRoom(clinicId)` returning
   `clinic:${clinicId}:proposal-queue` — reusing the *same* Socket.io server/transport/rate-limit/auth
   machinery, but as an explicitly-documented **advisory nudge only** ("a proposal changed, go refetch the
   queue via the normal authenticated REST path") — never carrying the proposal's actual content over the
   socket. This keeps the "never domain state on this channel" contract intact by construction (the socket
   payload is a bare "queue changed" ping with no citation/summary content), while reusing the connection
   infra.
2. **Don't use R-RTC-1 at all** — poll the approval-queue endpoint on a short interval (e.g. on focus / a
   30s timer) from the console and mobile home surfaces instead. Simpler, zero new realtime surface,
   arguably fine given approval-queue volume is bounded and non-urgent (noise-discipline is an explicit
   design goal per the roadmap — "never an alert firehose").

This plan's mild preference is option 1 (nudge-only, reusing R-RTC-1's transport) since the roadmap's own
technical scope explicitly says "queue updates over the additive Socket.io channel" — but flags that this
still needs an explicit new room-shape addition to `rooms.ts` (not present today) plus a one-line addition
to whatever payload-shape contract `server/lib/realtime-collab/rooms.ts`'s `JoinRequest` union enforces,
and it must ship with an explicit test asserting the socket payload carries no citation/summary/draft
content — only a change signal. **No parallel realtime authority path**: this channel never becomes a
second source of truth for whether a proposal exists or its status; the REST route (§1.6) is always the
authority, the socket only prompts a refetch.

### §1.6 Route — `server/routes/action-proposals.ts`

Recreate (spike left this typechecking but deliberately unmounted). Mount for real in
`server/app/routes.ts` this time. Endpoints, all `clinicId`-scoped from `req.authUser`:

- `GET /api/action-proposals?status=staged&kind=<kind>` — list, paginated.
- `POST /api/action-proposals/:id/approve`
- `POST /api/action-proposals/:id/edit` — body validated against each kind's `draftContent` shape (the
  spike's "minimal checks" note in findings §7.4 — this plan requires per-kind Zod validation of the edited
  content shape, not a generic passthrough).
- `POST /api/action-proposals/:id/reject` — body: `{ rejectionReason: string }`.

Rate-limited via the existing `server/middleware/rate-limiters.ts` pattern (mirror the 20/min
checkout/return limiter class, not the 100/min global one — these are deliberate human actions, not
high-frequency reads).

---

## §2 — Proposal type: `shift_handover_draft`

**⚠️ Gated by §0 — do not begin the worker/scheduler-retirement portion of this slice until the owner has
signed off on an R-SH-F1 cutover mechanism.** The schema/composer/citation-validator/route/UI portions
below can be built and shadow-tested without touching `shift-handover-scheduler.ts` at all (they only
*read* `resolveShiftWindow`/`aggregateDeltas`, which is already safe — the spike proved this). Only the
literal act of changing what `start-schedulers.ts` calls, or gating `scanEndedShiftsForHandover` per §0(c),
requires the sign-off.

### Content source (already exists — real, confirmed)

`resolveShiftWindow` (`server/lib/shift-handover-generator.ts:137`) is already exported and reusable
as-is. `aggregateDeltas` (`server/lib/shift-handover-generator.ts:189`) is currently a **private**
`async function aggregateDeltas(...)` — NOT exported in this tree. The unmerged Task 0.3 spike
(commit `951aa8f9e`) added the `export` keyword as its one-line diff to this file, but that spike was
never merged, so this tree still needs that one-keyword visibility change applied for real before
`resolveShiftWindow`/`aggregateDeltas` can be imported from the new autopilot module. `classifyDeltaKind`
(`server/lib/shift-handover-generator.ts:104`) is already exported and reusable as-is.

### Files (new, this tree)

- `server/lib/autopilot/handover-draft-composer.ts` — pure, `ShiftHandoverDeltas` → `NewActionProposalInput`
  (kind `shift_handover_draft`), citing every delta entry's `sourceId`/`kind`/`at` as an
  `ActionProposalCitedFact`.
- `server/workers/autopilotHandoverDraftWorker.ts` + `server/queues/autopilotHandoverDraft.queue.ts` —
  BullMQ worker, periodic scan of recently-ended `vt_shift_sessions` (same scan shape as
  `scanEndedShiftsForHandover`, but staging a proposal instead of auto-publishing). Register in
  `server/app/start-schedulers.ts` **additively** — do not remove `startShiftHandoverScheduler()`'s
  registration until §0's decision is executed.
- Client: approval-queue UI (§1.4 shared shell, see below) plus a `shift_handover_draft`-specific card
  renderer, e.g. `src/features/autopilot/cards/HandoverDraftCard.tsx`, reusing
  `src/components/handover-artifact-panel.tsx`'s existing delta-rendering pieces (grep and confirm its
  exported sub-components before duplicating rendering logic — the artifact shape (`ShiftHandoverDeltas`)
  is identical between R-SH-F1's live artifact and this proposal's `draftContent`).

### Tests (RED before GREEN)

- `tests/autopilot/handover-draft-composer.test.ts` — RED: fails to compile/import until the composer
  exists. GREEN: given a fixed `ShiftHandoverDeltas` fixture, asserts the composed `NewActionProposalInput`
  has `kind: "shift_handover_draft"`, one `citedFacts` entry per delta entry, and a human-readable summary
  through the typed `t.*` i18n accessor (not a hardcoded string — spike findings §7.8 flagged the spike's
  own `summarizeDeltas` as hardcoded English; this must not repeat that).
- `tests/autopilot/autopilot-handover-worker.test.ts` — RED: worker doesn't exist. GREEN: given an ended
  shift session with audit/outbox rows, one call stages exactly one `shift_handover_draft` proposal
  (idempotent per `(clinicId, kind, sourceSessionId)` — assert a second scan of the same session does not
  double-stage, mirroring the unique index).
- `tests/autopilot/action-proposal-citation-validator.test.ts` (shared file, but must include a
  `shift_handover_draft`-tagged case) — real citations validate `{valid:true}`; a fabricated `sourceId` is
  flagged `citation_not_grounded:...`.
- `tests/autopilot/action-proposal-service.test.ts` (shared) — approve/edit/reject transition guard +
  decision-log append, generalized from the spike's proven shape.

### i18n keys — `locales/{en,he}.json`

New top-level namespace `autopilotQueue.*` (not `appointmentsPage.*` — that namespace stays frozen for the
Tasks feature, unrelated). Minimum keys: `autopilotQueue.title`, `autopilotQueue.empty`,
`autopilotQueue.approve`, `autopilotQueue.edit`, `autopilotQueue.reject`, `autopilotQueue.citedFactsLabel`,
`autopilotQueue.kinds.shiftHandoverDraft.title`, `autopilotQueue.kinds.shiftHandoverDraft.summaryTemplate`.
Run `pnpm i18n:check` after adding both files (parity enforced).

### Audit + metrics

`AuditActionType` union (`server/lib/audit.ts`) additions: `action_proposal_staged`,
`action_proposal_approved`, `action_proposal_edited`, `action_proposal_rejected` (shared across all 4
kinds — add once here, reused by §3–§5, do not re-add per kind). Bounded counters via
`incrementMetric()` (`server/lib/metrics.ts`'s closed `MetricName` union): e.g.
`autopilot_proposal_staged_total`, `autopilot_proposal_approved_total`, etc. — no per-kind or per-clinic
label cardinality; if per-kind breakdown is wanted, use one counter name per (kind × outcome) pair, added
explicitly to the closed union, not a labeled metric.

---

## §3 — Proposal type: `coordinator_reassign_off_roster`

### Content source (does NOT exist yet — confirmed via grep + read)

Real schema: `vt_shift_equipment_coordinator` (`server/schema/ops.ts:66-95`) stores the *persisted*
per-shift-date coordinator assignment (`coordinatorUserId`, `source`, `escalationStage`,
`currentResponsibleUserId`). `resolveShiftCoordinator` (`server/services/equipment-coordinator.service.ts`)
**recomputes** the roster-derived eligible set fresh on every call via `matchOnShiftUsers` (roster rows
from `vt_shifts` for `(clinicId, shiftDate)`, joined to `vt_users` by normalized-name match) — it does not
persist or compare against the stored assignment.

**"Off-roster" is not detected anywhere today** — confirmed: `resolveShiftCoordinator` only derives a
*fresh* resolution; nothing in `server/services/equipment-coordinator.service.ts` or
`server/workers/sweep-escalation.worker.ts` compares a **persisted** `shiftEquipmentCoordinator` row's
`coordinatorUserId` against a **re-resolved** current on-shift set to detect that the assigned coordinator
has left/rolled off since assignment. The existing escalation ladder
(`server/workers/sweep-escalation.worker.ts`) escalates based on *sweep completion vs. shift-end time*, a
different signal entirely (not roster drift).

**New content source to build:** `CoordinatorRosterReader` port —
`server/lib/autopilot/coordinator-roster-reader.port.ts` — given `(clinicId, shiftDate)`:
1. Read the persisted `vt_shift_equipment_coordinator` row (if any) for that `(clinicId, shiftDate)`.
2. Re-run `matchOnShiftUsers`-equivalent roster resolution (reuse `resolveShiftCoordinator` directly rather
   than reimplementing the roster-match — it already returns `candidates`; a persisted
   `coordinatorUserId` not present in the current `candidates` list, and not equal to
   `currentResponsibleUserId` if stage ≥ 3, is the "off-roster" signal).
3. Emit an `ActionProposalCitedFact` per contributing row: the stale `vt_shift_equipment_coordinator` row
   itself (`sourceTable: "vt_shift_equipment_coordinator"`), and the `vt_shifts` roster rows used to
   determine the persisted coordinator is no longer matched (`sourceTable: "vt_shifts"`).

### Files (new)

- `server/lib/autopilot/coordinator-roster-reader.port.ts` — real port + in-memory test fake.
- `server/lib/autopilot/coordinator-reassign-composer.ts` — pure composer: given the reader's output,
  compose a `NewActionProposalInput` (kind `coordinator_reassign_off_roster`) whose `draftContent` proposes
  a specific replacement candidate (the current `candidates` list from `resolveShiftCoordinator`, filtered
  to on-shift + eligible, senior-fallback tie-break identical to the existing resolver's own rule — reuse
  the resolver's tie-break, do not invent a new one).
- `server/workers/autopilotCoordinatorReassignWorker.ts` + matching BullMQ queue file — periodic scan
  (reuse the sweep-escalation worker's shift-date candidate-scan shape,
  `findActiveShiftClinicDates`-equivalent, rather than reinventing shift-date iteration).
- Client: `src/features/autopilot/cards/CoordinatorReassignCard.tsx`.

### Tests (RED before GREEN)

- `tests/autopilot/coordinator-roster-reader.test.ts` — RED: port doesn't exist. GREEN: given a persisted
  coordinator row whose `coordinatorUserId` is absent from a freshly-resolved on-shift candidate set,
  the reader flags off-roster; given a persisted row still present in the candidate set, it does not.
- `tests/autopilot/coordinator-reassign-composer.test.ts` — composed proposal cites the stale assignment
  row + current roster rows; proposes a candidate drawn only from the current eligible+on-shift set.
- `tests/autopilot/autopilot-coordinator-worker.test.ts` — idempotent per `(clinicId, kind, shiftDate)`
  used as `sourceSessionId`.
- Citation-validator case (shared file, §1.4) tagged for this kind.

### i18n

`autopilotQueue.kinds.coordinatorReassignOffRoster.title`, `.summaryTemplate`,
`.proposedCandidateLabel`.

### Note on interaction with the existing escalation ladder

This proposal type and `sweep-escalation.worker.ts`'s auto-transfer (stage 3,
`currentResponsibleUserId`) are **two different mechanisms answering two different questions** — the
escalation ladder answers "sweep isn't done, who's on the hook now" (already automatic, already shipped,
outside Task 1.1's scope to touch); this proposal answers "the assigned coordinator appears to have left
roster, should someone else be assigned." Do not conflate them or route one through the other — flag this
distinction explicitly in the PR description so a reviewer doesn't read this as duplicating or replacing
the escalation ladder.

---

## §4 — Proposal type: `restock_po_on_burn`

### Content source (does NOT exist yet — confirmed via grep)

Real schema fields exist: `inventoryItems.parLevel`, `inventoryItems.reorderPoint`
(`server/schema/inventory.ts:48-50`), `containerItems.quantity` (current on-hand per container-item pair,
`server/schema/inventory.ts:109`), `dispenseEvents.items` (jsonb `[{itemId, quantity}]`,
`server/schema/inventory.ts:230`), `purchaseOrders`/`poLines` (draftable PO shape,
`server/schema/inventory.ts:254-292`).

**Confirmed nothing reads `reorderPoint` for any triggering logic today** — grep across `server/` and
`src/` shows every reference to `reorderPoint` is CRUD only (`server/routes/inventory-items.ts` validation
+ persistence, `src/lib/api.ts` request shape, `src/types/inventory.ts` type). No burn-rate computation, no
reorder-point comparison, exists in `server/services/restock.service.ts` or anywhere else. This is a
genuinely new content source.

**New content source to build:** `RestockBurnReader` port —
`server/lib/autopilot/restock-burn-reader.port.ts` — given `clinicId`:
1. For each active `inventoryItems` row with a non-null `reorderPoint`, sum current on-hand across
   `containerItems.quantity` for that item (join on `itemId`).
2. Compute a burn rate from `dispenseEvents` (status `COMPLETED`, `items[].itemId` matching) over a
   trailing window (e.g. 7 days — this window length is a product decision to record explicitly in the
   composer, not silently hardcoded without a named constant).
3. Flag items where projected on-hand (current − burn-rate-adjusted projection) crosses `reorderPoint`
   before the next expected restock cycle, OR simply where current on-hand ≤ `reorderPoint` right now (the
   simpler, more defensible v1 rule — recommend starting with the simple threshold-crossing rule and
   deferring rate-projection to a later iteration, since projection introduces a forecasting model that
   needs its own validation before being cited as a "fact").
4. Cite the specific `containerItems` rows (current quantity) and the `inventoryItems.reorderPoint` value
   as the grounding facts — never a derived/projected number as a citation (only observed DB values are
   citable facts, consistent with the citation-validator's "checkable against ground truth" contract).

### Files (new)

- `server/lib/autopilot/restock-burn-reader.port.ts` — real port + in-memory test fake, `clinicId`-scoped.
- `server/lib/autopilot/restock-po-composer.ts` — pure composer: reorder-triggered items → a draft PO line
  set (`draftContent` shaped like `poLines` input: `{itemId, quantitySuggested}[]`), NOT an inserted
  `purchaseOrders`/`poLines` row — the proposal stages a *draft*; only `approveProposal` (or a later
  `enforce`-gated auto-execution, out of scope here) actually inserts the PO.
- `server/workers/autopilotRestockBurnWorker.ts` + queue file — periodic scan (daily cadence is a
  reasonable default given restock is not a per-minute operational surface — confirm against
  `server/app/start-schedulers.ts`'s existing daily-cron pattern, e.g. `expiryCheckWorker`'s 08:00 cron).
- Client: `src/features/autopilot/cards/RestockPoCard.tsx`.
- On approve: `approveProposal` for this kind needs a kind-specific side effect (insert the actual
  `purchaseOrders` + `poLines` rows) — this is the one place among the 4 kinds where "approve" does more
  than flip a status; document this explicitly in `action-proposal-service.ts`'s `approveProposal` as a
  kind-dispatched side effect, not a generic status flip.

### Tests (RED before GREEN)

- `tests/autopilot/restock-burn-reader.test.ts` — RED: port doesn't exist. GREEN: given an item with
  `reorderPoint = 10` and summed `containerItems.quantity = 8` across its containers, the reader flags it;
  an item at `quantity = 12` is not flagged; an item with `reorderPoint = null` is never considered
  (untracked, per the column's own documented semantics).
- `tests/autopilot/restock-po-composer.test.ts` — composed `draftContent` cites only observed
  `containerItems`/`inventoryItems` rows, never a projected number, as `citedFacts`.
- `tests/autopilot/autopilot-restock-worker.test.ts` — idempotent per `(clinicId, kind, <date-or-scan-id>)`.
- `tests/autopilot/action-proposal-service.test.ts` — extend with a case asserting `approveProposal` for
  `restock_po_on_burn` inserts real `purchaseOrders`/`poLines` rows exactly once (idempotent on retry).
- Citation-validator case tagged for this kind.

### i18n

`autopilotQueue.kinds.restockPoOnBurn.title`, `.summaryTemplate`, `.suggestedQuantityLabel`.

---

## §5 — Proposal type: `crash_cart_drift`

### Content source (does NOT exist yet — confirmed via grep)

Real schema: `crashCartItems.requiredQty` (`server/schema/er.ts:99`), `crashCartItems.expiryWarnDays`
(`server/schema/er.ts:100` — **confirmed unused**: grep shows every reference is CRUD-only in
`server/routes/crash-cart.ts` and the shared type file, nothing computes an expiry-approaching signal),
`crashCartChecks.itemsChecked` (`[{key, label, checked}]` — a **boolean per item**, not a quantity —
`server/schema/er.ts:119`), `crashCartChecks.allPassed` (`server/routes/crash-cart.ts:187`, computed as
`items.every((item) => item.checked)` at check-submission time — an existing, real, but check-time-only
computation, not a standing drift signal).

**"Drift" is not detected anywhere as a standing/monitored condition today** — confirmed:
`crash-cart.ts`'s route only computes `allPassed` at the moment a check is submitted; nothing scans for
(a) the *most recent* check having any `checked: false` entries persisting unaddressed, or (b) staleness
— no check performed within a clinic-configured interval. Both are genuinely new content sources.

**New content source to build:** `CrashCartDriftReader` port —
`server/lib/autopilot/crash-cart-drift-reader.port.ts` — given `clinicId`:
1. Read the most recent `crashCartChecks` row (`orderBy(desc(performedAt)).limit(1)`).
2. **Missing-item drift:** if that row's `allPassed === false`, cite the specific `itemsChecked` entries
   with `checked: false` (matched back to `crashCartItems` by `key`) as the grounding facts.
3. **Staleness drift:** if no check exists within a configurable interval (this plan does not invent a
   number — flag at execution time whether an existing clinic-config convention like
   `vt_server_config`'s key-embedding pattern, or a fixed constant, should carry this threshold; do not
   silently hardcode a clinical safety interval without it being reviewable), propose a "crash cart check
   is overdue" proposal citing the last check's `performedAt` (or the absence of any row) as the fact.
4. `expiryWarnDays` is **not** wired into this content source for v1 — using it would require expiry-date
   data on individual crash-cart stock that does not exist in `crashCartItems` (the column is
   `expiryWarnDays`, a lead-time in days, but there's no corresponding "this specific unit expires on
   date X" field anywhere in `er.ts` to compute against). Flag this as a real gap, not a silent omission —
   if expiry-based drift is wanted, it needs its own schema addition (out of scope for this plan; note as
   a follow-up).

### Files (new)

- `server/lib/autopilot/crash-cart-drift-reader.port.ts` — real port + in-memory test fake.
- `server/lib/autopilot/crash-cart-drift-composer.ts` — pure composer, two draft shapes (missing-item vs.
  staleness), both under kind `crash_cart_drift` distinguished by a `draftContent.driftType` field.
- `server/workers/autopilotCrashCartDriftWorker.ts` + queue file — periodic scan (reuse
  `expiryCheckWorker`'s daily-cron shape as the nearest existing analog, or a shorter interval if a shift-
  aligned check makes more sense clinically — a call for whoever executes this, not fixed here).
- Client: `src/features/autopilot/cards/CrashCartDriftCard.tsx`.

### Tests (RED before GREEN)

- `tests/autopilot/crash-cart-drift-reader.test.ts` — RED: port doesn't exist. GREEN: (a) most-recent check
  has a `checked: false` entry → flagged with that entry cited; (b) most-recent check is `allPassed: true`
  → not flagged; (c) no check within the configured interval → staleness-flagged citing the absence/last
  `performedAt`.
- `tests/autopilot/crash-cart-drift-composer.test.ts` — both drift-type branches compose distinct,
  correctly-cited `draftContent`.
- `tests/autopilot/autopilot-crash-cart-worker.test.ts` — idempotent per `(clinicId, kind, <scan-date>)`.
- Citation-validator case tagged for this kind.

### i18n

`autopilotQueue.kinds.crashCartDrift.title`, `.missingItemSummaryTemplate`, `.staleSummaryTemplate`.

---

## §6 — Approval-queue UI (shared shell, all 4 kinds)

Per roadmap design scope: "approval queue home screen — one-tap approve/edit/reject; citation-grounded
'why' linked to outbox facts; shadow-vs-enforce visual language; noise discipline; `aria-live` on arriving
proposals; mobile-first + console variant + board ambient count; i18n he+en."

### Placement (confirmed real mount points)

- **Mobile / lead's home screen:** `src/features/today/surfaces/OpsHomeSurface.tsx` (confirmed: `home.tsx`
  routes `homeSurface === "ops"` — admin/lead — to `OpsHomeSurface` on phone/desktop-web, or
  `HomeTabletDashboard` on native iPad tablet). Add a new queue-summary tile/card to `OpsHomeSurface.tsx`
  (mirror the existing `src/features/today/surfaces/ops/ExceptionsTile.tsx` pattern — same surface, same
  tile-composition convention) plus a full queue page reachable from it.
- **Full queue page:** new route, e.g. `src/pages/autopilot-queue.tsx`, registered in `src/app/routes.tsx`
  (mirror the existing lazy-import + `<Route>` pattern, e.g. next to `AlertsPage`'s registration). Reachable
  from both the mobile tile and a console nav entry — **not** behind `WebOnlyGuard` (this is a mobile-first
  surface per the roadmap's design scope, unlike the admin-only Autopilot Policy console screen from Task
  0.4 §7, which stays `WebOnlyGuard` + admin-gated).
- **Console variant:** the same `src/pages/autopilot-queue.tsx` route, responsive (desktop breakpoint gets
  a denser table-like layout; confirm against the existing responsive pattern in
  `src/features/equipment/tablet/EquipmentMasterDetail.tsx` or similar master-detail pages already in the
  route table, rather than inventing a new breakpoint convention).
- **Board ambient count:** `src/features/command-board/components/BoardAttentionSection.tsx` (confirmed
  real file) is the existing pattern for an ambient attention-count tile on the Command Board
  (`src/board/BoardShell.tsx` → `CommandBoardScreen`). Add a bounded "N proposals awaiting approval" count
  here — count only, no proposal content on the board (board is a kiosk/ambient display, not a task
  surface — matches the roadmap's "board ambient count" phrasing exactly, and matches the Liquid Glass
  track's guardrail that glass/detail chrome stays off ambient board surfaces).

### Shared components (new)

- `src/features/autopilot/ProposalQueueList.tsx` — container, fetches via a new `api.actionProposals.*`
  namespace in `src/lib/api.ts` (+ matching types in `src/types/action-proposals.ts` — per the repo's API
  client pattern: every new endpoint needs a typed function in `api.ts` + a type in `src/types/`).
- `src/features/autopilot/ProposalCard.tsx` — presentational shell (citation list, approve/edit/reject
  buttons, shadow-vs-enforce badge), with each kind's specific card (§2–§5) composing it via a
  `renderDraftContent` slot (render-prop pattern per this repo's web coding-style rules on compound
  components/slots).
- `aria-live="polite"` region wrapping the list for arriving proposals (accessibility requirement from the
  roadmap's design scope) — verify with the `accessibility-review` skill or the `scan` skill against a live
  render before calling this done.
- Shadow-vs-enforce visual language shared with Task 0.4's Autopilot Policy console screen (§7 of that
  doc) — the same badge/copy pair should be used in both places; if Task 0.4's console screen is built
  later than this queue, this queue's badge component should be the one both surfaces import from (name it
  once, e.g. `src/components/autopilot-mode-badge.tsx`, so the second consumer doesn't duplicate it).

### RTL / Hebrew-default

All copy through `t.*`, Hebrew is default locale — verify RTL rendering of the citation list and
approve/edit/reject action row explicitly (this repo's Hebrew-RTL conventions apply — check existing
patterns like `Bdi`/truncate helpers noted in prior remediation work before hand-rolling new RTL handling).

---

## §7 — Slice order recommendation

Recommended order, one PR-sized slice per proposal type, per the roadmap's own instruction ("one proposal
type per PR-sized slice"):

1. **§1 shared infrastructure** (schema, ports skeleton, writer/service, citation-validator base, route,
   shared UI shell) — a foundational slice with no proposal-kind-specific logic yet, needed by all 4.
2. **§3 `coordinator_reassign_off_roster`** — ship first among the 4 kinds. Rationale: its content source
   (`resolveShiftCoordinator`, roster-match) is real, already-shipped, well-tested logic (Docking P3); the
   only new work is a comparison layer + composer, the smallest genuinely-new content source of the three
   non-handover kinds. It has **no §0-style gating tension** (nothing to retire), so it can prove the
   shared infrastructure (§1) end-to-end in production shadow mode fastest, with the lowest content-source
   risk, before tackling kinds with real new signal-detection logic (burn-rate math, drift/staleness rules)
   or the R-SH-F1 rollout-safety question.
3. **§4 `restock_po_on_burn`** — second. Real schema exists (`parLevel`/`reorderPoint`/`containerItems`),
   the simple threshold-crossing rule (§4, step 3's recommended v1) is low-risk to reason about, and it
   exercises the one case where "approve" has a real side effect (inserting a PO) — useful to prove out
   before the higher-stakes handover kind.
4. **§5 `crash_cart_drift`** — third. Similar shape to restock but touches a clinical-safety-adjacent
   surface (crash cart readiness) — sequence after restock so the citation-validator/composer/worker
   pattern is already proven twice on lower-stakes kinds first. The staleness-threshold sub-question (§5
   step 3) should be resolved (even if just "pick a constant, document it") before this slice starts.
5. **§2 `shift_handover_draft`** — **last**, deliberately. Its content source is the most mature (real,
   already-shipped R-SH-F1 logic) so the composer/citation work itself is low-risk — but §0's rollout-safety
   question is a real, unresolved product decision with operational-safety weight for a hospital, and
   nothing about building the other 3 kinds first is blocked by leaving it unresolved. Sequencing it last
   maximizes the time available for the owner to make that call deliberately, rather than it becoming a
   rushed decision blocking the whole task. The schema/composer/citation-validator/UI work for this kind
   can still proceed in parallel with §0's resolution (per §2's opening note) — only the
   scheduler-retirement wiring itself waits.

---

## §8 — Cross-cutting verification checklist (all 4 slices)

- `pnpm typecheck` — 0 errors (frontend + server tsconfigs), after each slice.
- `pnpm exec vitest run tests/autopilot/**` — every new suite green, per-kind, before merging that slice.
- `pnpm i18n:check` — locale parity after every `locales/{en,he}.json` edit.
- Multi-tenancy: every new query in every new port/service/route carries an explicit `clinicId` predicate —
  re-verify per file, per the pattern already proven in the spike's ports (findings §9's independent
  re-verification note is the bar to match, not just "looks scoped").
- Frozen-surface diff check: `git diff` against `server/lib/shift-handover-scheduler.ts`,
  `server/lib/realtime-outbox.ts`, `server/lib/event-publisher.ts`, and any Code Blue file — must be empty
  until §0 is resolved and the scheduler-retirement slice specifically begins.
- Screenshots: mobile + console, RTL (he) + LTR (en), per the roadmap's Verify criteria — capture the
  approval-queue list, one expanded proposal card per kind, and the board ambient-count tile.
- Bounded counters only: every new `incrementMetric()` call name added to the closed `MetricName` union in
  `server/lib/metrics.ts`, no per-clinic/per-user labels.
