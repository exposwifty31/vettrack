# R-SH-F1 — Shift handover artifact (SUB-SPEC · LARGE + plan)

- **Covers:** medium-02 (spec §5.2). **Scope is a SUPERSET of the original brief (owner).** LARGE — new table + generator + route + audit kind + a **PMS-integration seam**.
- **Extends the EXISTING `/handoff`** — `src/pages/handoff.tsx` renders `ShiftSummarySheet` today (the brief's "no /handoff exists" premise is stale). Do NOT create a second route.
- **Card contract:** RED→GREEN→verify; standard feature checklist (spec §2.5); frozen guardrails per card.

## Locked scope (owner) — four dimensions
1. **All 4 delta types** — custody moves, task state, alerts, dispenses (not a subset).
2. **Per-technician patient/animal worklist** — which animals each tech worked on. ⚠ **sourced from the external PMS (Priza), NOT a reintroduced internal patient model** (internal patient/ER tables were removed, migrations 142–143).
3. **App-observed signals** — system-derived observations during the shift (custody/scan/readiness/alert events in the shift window), not just manually-logged actions.
4. **Future integration — Priza:** shape the schema + generator so dimensions (2) and (3) can be **sourced from / exported to Priza without a rewrite** — a stable, integration-friendly contract; do NOT hard-couple to internal-only sources.

## Reuse anchors (verify at build)
`src/pages/handoff.tsx` (`ShiftSummarySheet` — extend) · `vt_shifts` / `vt_shift_sessions`; `server/routes/shifts.ts`, `shift-adjustments.ts`, `shift-chat.ts` · `vt_audit_logs` + `vt_event_outbox` (the delta sources) · `notification.worker` (push to incoming shift) · `src/features/today/surfaces/*` (entry point) · `server/integrations/` (the PMS seam for Priza).

## Frozen guardrails (every card)
`clinicId`-scoped · deltas read from existing audit/outbox — **no new realtime path** · **ack = a deliberate confirm** (attestation — the sanctioned exception to undo-first) · the Priza contract stays stable/integration-friendly (no internal-only hard-coupling) · no reintroduced internal patient model.

---

### R-SH-F1.1 · Schema (`vt_shift_handover`) shaped for Priza
- **Goal:** `vt_shift_handover` (`clinicId, shiftSessionId, deltas (4 types), openItems[], observedSignals, patientWorklist (nullable — PMS-sourced), acknowledgedBy, generatedAt, acknowledgedAt`). Migrate; new `AuditActionType` for generate + acknowledge. The `patientWorklist` shape must be a **PMS-agnostic contract** (external ids + display), not FKs to removed internal tables.
- **RED:** `tests/migrations/shift-handover.test.ts` (DB-integration) + a type test that `patientWorklist` carries external PMS ids, not internal patient FKs.
- **Verify:** DB-integration runner + `pnpm typecheck`.

### R-SH-F1.2 · Delta generator (all 4 types) at shift end
- **Goal:** a generator that runs at shift end aggregating the shift-window deltas from `vt_audit_logs` + `vt_event_outbox` into a compact artifact + open-items list.
- **RED:** `tests/shift-handover-generator.test.ts` — a seeded shift with a known set of custody/task/alert/dispense mutations → the handover lists **exactly** those deltas + open items.
- **Guardrail:** read from existing audit/outbox; no new realtime path.

### R-SH-F1.3 · App-observed signals
- **Goal:** add system-derived observations (custody/scan/readiness/alert events attributable to the shift window) beyond manually-logged actions.
- **RED:** `tests/shift-handover-observed.test.ts` — seeded system events in the window appear as observed signals; events outside the window excluded.

### R-SH-F1.4 · Patient/animal worklist via the Priza PMS seam
- **Goal:** populate `patientWorklist` from the external PMS through `server/integrations/` (Priza adapter). **v1 degrades gracefully** if Priza is not connected (empty worklist, not an error).
- **RED:** `tests/shift-handover-patient-worklist.test.ts` — a **mocked Priza feed** populates the worklist per tech; with no PMS configured, the worklist is empty and the rest of the handover still generates.
- **Guardrail:** no internal patient model; the adapter boundary is the only patient-data source.

### R-SH-F1.5 · Surface — extend `/handoff` + acknowledge + push
- **Goal:** render the artifact on the existing `/handoff` (`ShiftSummarySheet`); **iPhone = consume + acknowledge** (deliberate confirm, `aria-pressed`, reversible within the shift), **iPad = two-pane authoring**; push to the incoming shift; single `<h1>` + logical heading hierarchy; deep-link entry falls back to `/home` (covered by test); RTL + he/en parity.
- **RED:** `tests/shift-handover-surface.test.tsx` — ack records `acknowledgedBy` + fires the push; heading hierarchy; deep-link fallback; RTL bidi-isolation of LTR staff names.

### R-SH-F1.6 · Verification (acceptance bar)
- Seeded shift with known mutations → handover lists exactly those deltas + open items + observed signals.
- Acknowledge records `acknowledgedBy`; incoming shift receives the push.
- Patient worklist populates from a mocked Priza feed; empty-safe with no PMS.
- RTL spot-check of `/handoff` (default + empty + loading + error states).

## Open decisions (confirm at build)
- Auto-generate at shift end only, or also an on-demand "handover now" button?
- Priza feed timing/availability — real-time vs end-of-shift pull; the adapter contract shape.
