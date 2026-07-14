# PLAN.md

> The single source of truth for what is being built right now.
> Agents read this before writing any code.
> Update when the plan changes. Do not let it drift from reality.
> Archive completed plans to `docs/plans/YYYY-MM-DD-[feature].md`

---

## Metadata

| | |
|-|-|
| **Feature / Sprint** | Consolidated Audit × 10x |
| **Author** | VetTrack Team |
| **Created** | 2026-07-12 |
| **Last updated** | 2026-07-12 |
| **Status** | `in-progress` — Phase 0 |
| **Branch** | `claude/audit-10x-consolidated-plan` (off `main`) |
| **Tasks** | See TASKS.md |
| **Plan library** | `docs/plans/consolidated-audit-10x/README.md` |

---

## Problem

A behavioral flow audit (36 findings: 6 HIGH · 21 MED · 9 LOW) plus a 12-item 10x feature library need one sequenced program so features are never built on broken surfaces, and App Store re-review (Guideline 2.1 reviewer reachability) is unblocked first.

Scope change (June 2026) still holds: ER/patient/hospitalization, medication tasks, drug formulary, and pharmacy forecast remain removed (`docs/scope-change-2026.md`).

---

## Goal

Execute the consolidated remediation + 10x program **stabilize → extend**, phased:

| Phase | Theme | Plan doc |
|---|---|---|
| **0** | Stabilize + ship-ready (6 HIGH + 0B submission gate + on-device exit drill) | `docs/plans/consolidated-audit-10x/phase-0-1.plan.md` |
| **1** | Do-Now: equipment / shift / inventory fixes + small features + web admin-gate | same |
| **2** | Native MED sweep + Do-Next features (Code Blue / board / predictive) | `phase-2-3.plan.md` + sub-specs |
| **3** | LOW cleanup | `phase-2-3.plan.md` |
| **4** | Gated Massives (on hold except RFID-gate `R-M1`) | `phase-4.plan.md` + `subspecs/R-M1-*.plan.md` |

**Current focus:** Phase 0. Do not start Phase 1 code until T-16 (on-device exit drill) passes.

---

## Source of truth

| Doc | Role |
|---|---|
| `docs/superpowers/specs/2026-07-12-audit-10x-consolidated-plan-design.md` | Design spec (requirements) |
| `docs/plans/consolidated-audit-10x/*.plan.md` + `subspecs/` | Executable TDD task cards |
| `docs/audit/flow-audit-behavioral-2026-07-11.md` | 36 findings |
| `docs/audit/PROOF_ALIGNMENT_LOG.md` | Evidence log per completed requirement |

Agents execute **plan cards**, not free-form interpretations of this file. Card contract: RED → GREEN → verify; ≤2 code files + 1 test; exact anchors; commit per card; log proof.

---

## Out of Scope

- ER/patient/hospitalization workflows (removed June 2026)
- Medication task management and drug formulary (removed June 2026)
- Pharmacy forecast engine (removed June 2026)
- WebSockets or polling as a realtime transport (SSE is frozen)
- Offline queueing of Code Blue / emergency mutations
- Appointment → task renames of internal surfaces (only copy changed)
- Any work in the Expo/RN mobile repo (`exposwifty31/literate-dollop`) — separate repo
- Phase 4 parked items until entry conditions clear: **massive-03** (clinic network), **medium-04** (copilot/voice)
- Starting Phase 1+ before Phase 0 exit drill (T-16) passes

---

## Constraints

- Every DB table must filter by `clinicId` — multi-tenancy is non-negotiable
- Realtime transport is frozen: SSE via `/api/realtime/stream`, not WebSockets
- BroadcastChannel envelope shape (`cursor`, `buildTag`, `ts`, `senderNonce`, `kind`) is frozen
- `__VT_BUILD_TAG__` is the single source of truth for SW cache naming
- Emergency endpoints must never be cached (bypass is unconditional)
- Authority evaluators keep their `off | shadow | enforce` envelope
- Strategy A safety net stays byte-for-byte identical
- `AuditActionType` union is closed — new kinds added to the union explicitly
- Telemetry surfaces are bounded enums — no PII, no free-form labels
- `appointmentsPage.*` i18n namespace, `vt_appointments` table, `/api/appointments` route are not renamed
- `⚠ SUB-SPEC` / `⚠ FROZEN` cards follow README model routing (`S` / `S +R` / `O +R` / `Owner`) — never downgrade a protection floor

---

## Active Work Areas

### Phase 0A — HIGH fixes (code, TDD)

Execution order in `phase-0-1.plan.md`: **T-05 first**, then T-01…T-04 in any order.

| ID | Summary | Tier |
|---|---|---|
| T-05 | Pass QueryClient into `initSyncEngine()` | S +R |
| T-01 | Code Blue outcome Cancel dismisses without ending session | S +R |
| T-02 | Dock-Return + RFID sheets mount at page level | S |
| T-03 | QR auto-decode last-scanned-wins exactly once | S |
| T-04 | Room-radar Return works after canceled dialog | S |

### Phase 0B — Submission gate (Owner)

T-06…T-15: binary ops/config/account/build checks. **Not RED→GREEN.** See plan cards.

### Phase 0 exit

**T-16** on-device drill blocks leaving Phase 0.

### Later phases (queued — not Ready)

- **Phase 1:** T-17…T-31 (+ sub-spec R-SH-F1 handover)
- **Phase 2–3:** T-34…T-53 + Code Blue / board / predictive sub-specs
- **Phase 4 / unblocked Massive:** R-M1 RFID-gate e2e (authored); massive-03 / medium-04 on hold

---

## Testing Plan

Per card (unless Owner / delete-only / DB-integration):

```bash
pnpm test -- <card RED test file> && pnpm typecheck
```

Also as needed:

- `pnpm i18n:check` for new copy
- `pnpm test:playwright:phase9` for realtime/PWA frozen cards that require the browser drill
- DB-integration runner when a card says so
- Log evidence in `docs/audit/PROOF_ALIGNMENT_LOG.md` before marking a requirement done

---

## Rollback Plan

All changes land on feature branches merged via PR. Rollback = revert the merge commit on `main`. Database migrations include down migrations. No data-destructive operations without explicit sign-off.

---

## Open Questions

| Question | Owner | Status |
|----------|-------|--------|
| Phase 4 massive-03 buyer identity (single-clinic vs multi-site) | Owner | `blocked` |
| medium-04 entry after data-quality wins | Owner | `blocked` until P1 locate/badge (+ R-M1) |

---

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Consolidate audit + 10x into one phased program | Stabilize before extend; App Store 2.1 reachability first |
| Surface-bundled sequencing | Never ship a feature onto an open HIGH on its own surface |
| Sonnet-sized cards + Tier routing | Executable by lower-reasoning agents; frozen work gets review/drill floor |
| Phase 4 parks massive-03 + medium-04 | Highest-risk / data-quality gated; R-M1 already unblocked |
| ER/medication scope removed (June 2026) | Product decision — out of core ops platform scope |
