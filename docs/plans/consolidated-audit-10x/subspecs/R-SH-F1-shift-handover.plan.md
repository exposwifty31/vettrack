# R-SH-F1 — Shift handover artifact (SUB-SPEC · LARGE + plan)

- **Covers:** medium-02 (spec §5.2). **Scope is a SUPERSET of the original brief (owner).** LARGE — new table + generator + route + audit kind + a **PMS-integration seam**.
- **Extends the EXISTING `/handoff`** — `src/pages/handoff.tsx` renders `ShiftSummarySheet` today (the brief's "no /handoff exists" premise is stale). Do NOT create a second route.
- **Card contract:** RED→GREEN→verify; standard feature checklist (spec §2.5); frozen guardrails per card.
- **Tier (model routing):** **O +R** — Opus + `code-reviewer` gate (LARGE; new table + generator + the Priza PMS-integration seam). See README → "Execution driver".
- **All decisions are pinned in the cards below** (generator idempotent per `shiftSessionId`; Priza adapter error-vs-not-connected; incoming-shift push semantics; full RED coverage of the acceptance bar) — no open choices.
- **Route contract (pinned):** endpoints registered in `server/app/routes.ts`, all with `clinicId` derived **from the authenticated/system context only** (never request input). **`POST /api/shift-handover/:shiftSessionId/generate` — v1: invoked by the shift-end scheduler (server-internal / service context), NOT wired to `src/lib/api.ts` or any UI button** (this is consistent with the v1 decision "auto-generate at shift end; a manual *handover now* button — with its own api.ts fn + `≥ lead_technician` gate — is a later addition", so no manual trigger exists in v1); it is idempotent per `shiftSessionId` and persists/returns the `vt_shift_handover` artifact. **`POST /api/shift-handover/:id/acknowledge`** IS user-facing in v1 — a typed `src/lib/api.ts` fn + `src/types/` request/response type + UI: records `acknowledgedBy` + flips read-state; returns the updated artifact. Both render errors through the standard `apiError()` envelope (per-locale); the existing `/handoff` data path serves the read.
- **"Next-shift roster" resolution (pinned — ONE definition, reused):** a single shared helper over `vt_shifts` / `vt_shift_sessions` resolves the users rostered on the **next shift** for a clinic — the next shift = the earliest shift for that `clinicId` **starting after the current shift's end** — **with an explicit `clinicId` predicate on every read**. The SAME clinic-scoped set drives **both** (a) push-target selection on generate **and** (b) acknowledge authorization, so the users who may ack are exactly the users who were paged; a cross-clinic user is never in the set. The RED asserts push-targets ≡ ack-authorized set and the cross-clinic exclusion.

## Locked scope (owner) — four dimensions

1. **All 4 delta types** — custody moves, task state, alerts, dispenses (not a subset).
2. **Per-technician patient/animal worklist** — which animals each tech worked on. ⚠ **sourced from the external PMS (Priza), NOT a reintroduced internal patient model** (internal patient/ER tables were removed, migrations 142–143).
3. **App-observed signals** — system-derived observations during the shift (custody/scan/readiness/alert events in the shift window), not just manually-logged actions.
4. **Future integration — Priza:** shape the schema + generator so dimensions (2) and (3) can be **sourced from / exported to Priza without a rewrite** — a stable, integration-friendly contract; do NOT hard-couple to internal-only sources.

## Reuse anchors (verify at build)

`src/pages/handoff.tsx` (`ShiftSummarySheet` — extend) · `vt_shifts` / `vt_shift_sessions`; `server/routes/shifts.ts`, `shift-adjustments.ts`, `shift-chat.ts` · `vt_audit_logs` + `vt_event_outbox` (the delta sources) · `notification.worker` (push to incoming shift) · `src/features/today/surfaces/*` (entry point) · `server/integrations/` (the PMS seam for Priza).

## Frozen guardrails (every card)

**Every read/write to any table this workflow touches — `vt_audit_logs`, `vt_event_outbox`, `vt_shifts`/`vt_shift_sessions`, the notification + Priza-integration tables, and `vt_shift_handover` (+ its ack) — carries an explicit target-table `clinicId` predicate** (not merely "clinicId-scoped") · deltas read from existing audit/outbox — **no new realtime path** · **ack = a deliberate confirm** (attestation — the sanctioned exception to undo-first) · the Priza contract stays stable/integration-friendly (no internal-only hard-coupling) · no reintroduced internal patient model.

---

### R-SH-F1.1 · Schema (`vt_shift_handover`) shaped for Priza

- **Goal:** `vt_shift_handover` (`clinicId, shiftSessionId, deltas (4 types), openItems[], observedSignals, patientWorklist, acknowledgedBy, generatedAt, acknowledgedAt`). **`patientWorklist` is a discriminated, PMS-agnostic union — NOT a bare nullable:** `{ state: 'not_configured' } | { state: 'ready', entries: [{ externalId, display, byTechId }] } | { state: 'error', code }` — **`externalId`/`display` are the external PMS (Priza) animal identifier + label; `byTechId` is the INTERNAL VetTrack `vt_users.id` of the technician who worked that animal (NOT a PMS id), and every `byTechId` MUST resolve to a user in the SAME `clinicId` (validated on generate; a cross-clinic `byTechId` is rejected, never persisted)** — **`code` is a closed enum of safe error codes** (`unreachable | auth_failed | timeout | malformed | unknown`), **never a raw PMS message, identifier, URL, or credential** — so a PMS failure can **never** be serialized or read as an empty/ready worklist, and upstream failure detail never leaks into the artifact. External ids + display only — no FKs to removed internal tables. Migrate; new `AuditActionType` for generate + acknowledge.
- **RED:** `tests/migrations/shift-handover.test.ts` (DB-integration) + a type test that `patientWorklist` is the **discriminated union** (external PMS ids, not internal FKs) and that the **`error` state is distinguishable from `not_configured` and from a `ready` empty list** — an error can never collapse to "empty". **+ a runtime serializer/schema (zod) test that rejects an unknown `error.code` and strips any unsafe adapter message BEFORE persistence** — a TS type alone can't stop a raw PMS string being written. **+ a mixed-clinic negative: a `ready` entry whose `byTechId` belongs to another clinic is rejected (never persisted).**
- **Verify:** the DB-integration runner (`tests/migrations/shift-handover.test.ts`) + **`npx tsc --noEmit`** + **`pnpm typecheck`** (also covers the server tsconfig) + **`pnpm test`**.

### R-SH-F1.2 · Delta generator (all 4 types) at shift end

- **Goal:** a generator that runs at shift end aggregating the shift-window deltas from `vt_audit_logs` + `vt_event_outbox` into a compact artifact + open-items list. **Idempotent per `shiftSessionId`** — a re-run yields the same artifact with **no duplicate deltas**; every delta is scoped to the shift window `[start, end)`.
- **RED:** `tests/shift-handover-generator.test.ts` — a seeded shift with a known set of custody/task/alert/dispense mutations → the handover lists **exactly** those deltas + open items; **re-running the generator for the same `shiftSessionId` yields an identical artifact (no duplicates)**; deltas outside `[start, end)` are excluded; **cross-clinic negative — same-looking events seeded for another clinic are excluded (the target-table `clinicId` predicate holds on every read)**. **A retry returns the PERSISTED snapshot (identical, `generatedAt` unchanged); an intentional regeneration creates a NEW revision preserving the prior artifact** — identity holds via the persisted snapshot, never by re-pulling Priza.
- **Guardrail:** read from existing audit/outbox; no new realtime path.

### R-SH-F1.3 · App-observed signals

- **Goal:** add system-derived observations (custody/scan/readiness/alert events attributable to the shift window) beyond manually-logged actions.
- **RED:** `tests/shift-handover-observed.test.ts` — seeded system events in the window appear as observed signals; events outside the window excluded; **cross-clinic negative — a same-looking observed event from another clinic is excluded (observed signals have a separate read path; assert the `clinicId` predicate there too)**.

### R-SH-F1.4 · Patient/animal worklist via the Priza PMS seam

- **Goal:** populate `patientWorklist` from the external PMS through `server/integrations/` (Priza adapter). **Two distinct states (pinned):** *not configured* → **empty** worklist (graceful, no error); ***configured but failing*** → an **explicit error state** on the artifact — never silently show empty on failure. **The rest of the handover (deltas, open-items, observed-signals) still generates normally; only `patientWorklist` carries the error state** — a PMS failure never blocks the whole artifact.
- **RED:** `tests/shift-handover-patient-worklist.test.ts` — a **mocked Priza feed** populates the worklist per tech; **no PMS configured → `patientWorklist` is exactly `{ state: 'not_configured' }` (the discriminator, NOT an empty `ready` list) + the rest of the handover still generates; configured-but-failing adapter → `{ state: 'error', code }` on `patientWorklist` (not `not_configured`, not empty) while deltas/open-items/observed-signals still generate**.
- **Guardrail:** no internal patient model; the adapter boundary is the only patient-data source.

### R-SH-F1.5 · Surface — extend `/handoff` + acknowledge + push

- **Goal:** render the artifact on the existing `/handoff` (`ShiftSummarySheet`); **iPhone = consume + acknowledge** (deliberate confirm, `aria-pressed`, reversible within the shift), **iPad = two-pane authoring**. **Notification semantics (pinned — "clears the push" = a clinic-scoped persisted read-state transition, NOT a device-notification retraction):** the push targets the users rostered on the **next** shift for that clinic, fired **once** on generate; **acknowledgement records the actor (`acknowledgedBy`) and flips the handover's persisted, clinic-scoped notification read-state to *read* (so no follow-up push fires and the in-app indicator clears). Acknowledgement does NOT attempt to retract or cancel an already-delivered device notification** (an OS push can't be un-sent) — it only updates server read-state. Single `<h1>` + logical heading hierarchy; deep-link entry falls back to `/home`; RTL + he/en parity.
- **RED (full acceptance bar):** `tests/shift-handover-surface.test.tsx` — **generate** fires the push **once** to the next-shift roster (not the current shift); **ack records `acknowledgedBy`, flips the persisted clinic-scoped read-state to *read* (no follow-up push; the in-app indicator clears), and does NOT retract the already-delivered device notification — ack never fires a push**; **default / empty / loading / error states each render and are announced**; **iPhone consume+ack vs iPad two-pane** compositions differ; single `<h1>` + heading hierarchy; deep-link fallback to `/home`; **the acknowledge control is keyboard-operable — confirm AND unconfirm via keyboard-only activation; focus is visible, moves INTO the confirm affordance on open, and RETURNS to the trigger on unconfirm/close**; RTL bidi-isolation of LTR staff names; he/en parity.

### R-SH-F1.6 · Verification (acceptance bar)

- Seeded shift with known mutations → handover lists exactly those deltas + open items + observed signals.
- Acknowledge records `acknowledgedBy`; incoming shift receives the push.
- Patient worklist populates from a mocked Priza feed; empty-safe with no PMS.
- RTL spot-check of `/handoff` (default + empty + loading + error states).
- **Commands:** `npx tsc --noEmit` + `pnpm typecheck` (also covers the server tsconfig) + `pnpm test` + the targeted DB-integration + surface tests (`tests/migrations/shift-handover.test.ts`, `tests/shift-handover-generator.test.ts`, `tests/shift-handover-surface.test.tsx`) all green before the task is done.

## Resolved (were open decisions — now pinned)

- **Generation trigger:** **auto-generate at shift end** in v1; an on-demand "handover now" button is a later addition.
- **Priza feed:** an **end-of-shift pull** through the `server/integrations/` adapter (not a realtime feed in v1); the adapter contract is PMS-agnostic (external ids + display), with error-vs-not-connected distinguished (R-SH-F1.4).
