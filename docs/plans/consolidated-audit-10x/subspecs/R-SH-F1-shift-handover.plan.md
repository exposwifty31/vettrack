# R-SH-F1 — Shift handover artifact (SUB-SPEC · LARGE + plan)

- **Covers:** medium-02 (spec §5.2). **Scope is a SUPERSET of the original brief (owner).** LARGE — new table + generator + route + audit kind + a **PMS-integration seam**.
- **Extends the EXISTING `/handoff`** — `src/pages/handoff.tsx` renders `ShiftSummarySheet` today (the brief's "no /handoff exists" premise is stale). Do NOT create a second route.
- **Card contract:** RED→GREEN→verify; standard feature checklist (spec §2.5); frozen guardrails per card.
- **Tier (model routing):** **O +R** — Opus + `code-reviewer` gate (LARGE; new table + generator + the Priza PMS-integration seam). See README → "Execution driver".
- **All decisions are pinned in the cards below** (generator idempotent per `shiftSessionId`; Priza adapter error-vs-not-connected; incoming-shift push semantics; full RED coverage of the acceptance bar) — no open choices.

## Locked scope (owner) — four dimensions

1. **All 4 delta types** — custody moves, task state, alerts, dispenses (not a subset).
2. **Per-technician patient/animal worklist** — which animals each tech worked on. ⚠ **sourced from the external PMS (Priza), NOT a reintroduced internal patient model** (internal patient/ER tables were removed, migrations 142–143).
3. **App-observed signals** — system-derived observations during the shift (custody/scan/readiness/alert events in the shift window), not just manually-logged actions.
4. **Future integration — Priza:** shape the schema + generator so dimensions (2) and (3) can be **sourced from / exported to Priza without a rewrite** — a stable, integration-friendly contract; do NOT hard-couple to internal-only sources.

## Reuse anchors (verify at build)

`src/pages/handoff.tsx` (`ShiftSummarySheet` — extend) · `vt_shifts` / `vt_shift_sessions`; `server/routes/shifts.ts`, `shift-adjustments.ts`, `shift-chat.ts` · `vt_audit_logs` + `vt_event_outbox` (the delta sources) · `notification.worker` (push to incoming shift) · `src/features/today/surfaces/*` (entry point) · `server/integrations/` (the PMS seam for Priza).

## Frozen guardrails (every card)

**Every read from `vt_audit_logs`/`vt_event_outbox` and every write to `vt_shift_handover` carries an explicit target-table `clinicId` predicate** (not merely "clinicId-scoped") · deltas read from existing audit/outbox — **no new realtime path** · **ack = a deliberate confirm** (attestation — the sanctioned exception to undo-first) · the Priza contract stays stable/integration-friendly (no internal-only hard-coupling) · no reintroduced internal patient model.

---

### R-SH-F1.1 · Schema (`vt_shift_handover`) shaped for Priza

- **Goal:** `vt_shift_handover` (`clinicId, shiftSessionId, deltas (4 types), openItems[], observedSignals, patientWorklist, acknowledgedBy, generatedAt, acknowledgedAt`). **`patientWorklist` is a discriminated, PMS-agnostic union — NOT a bare nullable:** `{ state: 'not_configured' } | { state: 'ready', entries: [{ externalId, display, byTechId }] } | { state: 'error', reason }`, so a PMS failure can **never** be serialized or read as an empty/ready worklist. External ids + display only — no FKs to removed internal tables. Migrate; new `AuditActionType` for generate + acknowledge.
- **RED:** `tests/migrations/shift-handover.test.ts` (DB-integration) + a type test that `patientWorklist` is the **discriminated union** (external PMS ids, not internal FKs) and that the **`error` state is distinguishable from `not_configured` and from a `ready` empty list** — an error can never collapse to "empty".
- **Verify:** DB-integration runner + `pnpm typecheck`.

### R-SH-F1.2 · Delta generator (all 4 types) at shift end

- **Goal:** a generator that runs at shift end aggregating the shift-window deltas from `vt_audit_logs` + `vt_event_outbox` into a compact artifact + open-items list. **Idempotent per `shiftSessionId`** — a re-run yields the same artifact with **no duplicate deltas**; every delta is scoped to the shift window `[start, end)`.
- **RED:** `tests/shift-handover-generator.test.ts` — a seeded shift with a known set of custody/task/alert/dispense mutations → the handover lists **exactly** those deltas + open items; **re-running the generator for the same `shiftSessionId` yields an identical artifact (no duplicates)**; deltas outside `[start, end)` are excluded; **cross-clinic negative — same-looking events seeded for another clinic are excluded (the target-table `clinicId` predicate holds on every read)**.
- **Guardrail:** read from existing audit/outbox; no new realtime path.

### R-SH-F1.3 · App-observed signals

- **Goal:** add system-derived observations (custody/scan/readiness/alert events attributable to the shift window) beyond manually-logged actions.
- **RED:** `tests/shift-handover-observed.test.ts` — seeded system events in the window appear as observed signals; events outside the window excluded.

### R-SH-F1.4 · Patient/animal worklist via the Priza PMS seam

- **Goal:** populate `patientWorklist` from the external PMS through `server/integrations/` (Priza adapter). **Two distinct states (pinned):** *not configured* → **empty** worklist (graceful, no error); ***configured but failing*** → an **explicit error state** on the artifact — never silently show empty on failure. **The rest of the handover (deltas, open-items, observed-signals) still generates normally; only `patientWorklist` carries the error state** — a PMS failure never blocks the whole artifact.
- **RED:** `tests/shift-handover-patient-worklist.test.ts` — a **mocked Priza feed** populates the worklist per tech; **no PMS configured → empty worklist + the rest of the handover still generates; configured-but-failing adapter → an explicit error state on `patientWorklist` (not empty) while deltas/open-items/observed-signals still generate**.
- **Guardrail:** no internal patient model; the adapter boundary is the only patient-data source.

### R-SH-F1.5 · Surface — extend `/handoff` + acknowledge + push

- **Goal:** render the artifact on the existing `/handoff` (`ShiftSummarySheet`); **iPhone = consume + acknowledge** (deliberate confirm, `aria-pressed`, reversible within the shift), **iPad = two-pane authoring**. **Notification semantics (pinned):** the push targets the users rostered on the **next** shift for that clinic, fired **once** on generate; acknowledgement clears it. Single `<h1>` + logical heading hierarchy; deep-link entry falls back to `/home`; RTL + he/en parity.
- **RED (full acceptance bar):** `tests/shift-handover-surface.test.tsx` — ack records `acknowledgedBy` + fires the push **once to the next-shift roster** (not the current shift); **default / empty / loading / error states each render and are announced**; **iPhone consume+ack vs iPad two-pane** compositions differ; single `<h1>` + heading hierarchy; deep-link fallback to `/home`; RTL bidi-isolation of LTR staff names; he/en parity.

### R-SH-F1.6 · Verification (acceptance bar)

- Seeded shift with known mutations → handover lists exactly those deltas + open items + observed signals.
- Acknowledge records `acknowledgedBy`; incoming shift receives the push.
- Patient worklist populates from a mocked Priza feed; empty-safe with no PMS.
- RTL spot-check of `/handoff` (default + empty + loading + error states).

## Resolved (were open decisions — now pinned)

- **Generation trigger:** **auto-generate at shift end** in v1; an on-demand "handover now" button is a later addition.
- **Priza feed:** an **end-of-shift pull** through the `server/integrations/` adapter (not a realtime feed in v1); the adapter contract is PMS-agnostic (external ids + display), with error-vs-not-connected distinguished (R-SH-F1.4).
