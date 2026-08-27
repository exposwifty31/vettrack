# PLAN.md

> The single source of truth for what is being built right now.
> Agents read this before writing any code.
> Update when the plan changes. Do not let it drift from reality.
> Archive completed plans to `docs/plans/YYYY-MM-DD-[feature].md`

---

## Metadata

| | |
|-|-|
| **Feature / Sprint** | Consolidated Audit × 10x — **SUPERSEDED**, see status banner |
| **Author** | VetTrack Team |
| **Created** | 2026-07-12 |
| **Last updated** | 2026-08-13 |
| **Status** | `superseded` — active program is the RN store push (G3→G4→G5) |
| **Branch** | n/a (`claude/audit-10x-consolidated-plan` no longer exists) |
| **Tasks** | See TASKS.md |
| **Plan library** | `docs/plans/consolidated-audit-10x/README.md` |

---

> ## ⚠ 2026-08-13 — READ THIS FIRST
>
> **This plan is SUPERSEDED. Do not execute it, and do not treat its gates as blocking.**
> The whole "Phase 0 / T-16 exit drill / do not start Phase 1" ladder refers to a July
> program that finished. Between 2026-07-28 and 2026-08-13, PRs **#167–#181** merged to `main`
> (native push, RFID, reviewer-demo seed, the nine UX blockers, the doctor shift gate +
> migrations 181–184, and the TV Command Center board).
>
> **The active program is the RN store push**, tracked in `~/.claude/plans/store-submission-runbook.md`
> (owner track ‖ agent track) — get the React Native successor app into review on both stores.
> Its gate ladder is G3 (on-device verdict) → G4 (complete) → G5 (store readiness).
>
> **This repo's role in that program is now supporting, not primary.** The RN app lives in
> `exposwifty31/VetTrack---RN-Migration-`. What this repo still owns for the push:
> the server the RN app calls, the `@vettrack/contracts` package, and `well-known-assetlinks.ts`
> (needs the Play App Signing SHA-256 once the first AAB is uploaded).
>
> Phase 0A (T-05, T-01…T-04) COMPLETED 2026-07-12 — proof-logged (PROOF_ALIGNMENT_LOG
> "2026-07-12 — Consolidated Audit × 10x"; fixes re-verified in-code 2026-07-28:
> `src/hooks/use-sync.tsx:170` passes QueryClient, `src/pages/code-blue.tsx:328` dedicated
> Cancel path). The 2.0 roadmap (`docs/vettrack-2.0-roadmap.md`) resumes after the two
> submissions are in review — that ordering is the standing owner decision.

## Out of Scope

- ER/patient/hospitalization workflows (removed June 2026)
- Medication task management and drug formulary (removed June 2026)
- Pharmacy forecast engine (removed June 2026)
- WebSockets or polling as a realtime transport (SSE is frozen)
- Offline queueing of Code Blue / emergency mutations
- Appointment → task renames of internal surfaces (only copy changed)
- Any work in the external RN mobile repo (separate **public** repo `exposwifty31/VetTrack---RN-Migration-`; `literate-dollop` is retired as the active target, while its physical delete-versus-archive decision remains open — see `docs/plans/master-plan-2026-07.md` Layer 4)
- Phase 4 parked items until entry conditions clear: **massive-03** (clinic network), **medium-04** (copilot/voice)

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

## Open Questions

| Question | Owner | Status |
|----------|-------|--------|
| Phase 4 massive-03 buyer identity (single-clinic vs multi-site) | Owner | `blocked` |
| medium-04 entry after data-quality wins | Owner | `blocked` until P1 locate/badge (+ R-M1) |

---

