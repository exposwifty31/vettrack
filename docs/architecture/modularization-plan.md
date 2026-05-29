# VetTrack modularization plan

**Status:** Phase 1 complete (inventory + strategy). Slice 1 (`request-core.ts`) implemented.  
**Principle:** Incremental, behavior-preserving refactors — not a rewrite.

## Goals

- Improve maintainability and explicit domain boundaries
- Preserve runtime behavior, APIs, tenant isolation, offline/realtime, and worker contracts
- Reduce oversized modules without broad architectural churn

## Non-goals

- Replacing Express, Drizzle, TanStack Query, or Wouter
- Database schema changes as part of modularization
- Renaming frozen surfaces (`/api/appointments`, `appointmentsPage.*`, outbox event names, queue names)

## Current baseline (2026-05)

| Area | Scale | Primary pain |
|------|-------|----------------|
| Backend routes | 55 modules; largest `equipment.ts` ~1,386 lines (post–Slice 4j/4k/4l) | HTTP + DB + business mixed in routes |
| Backend services | 28 files; `appointments.service.ts` ~2,186 lines | ADR-002 accepted, not implemented |
| Schema | `server/schema/*` ~2,045 lines | Already domain-split — keep |
| Frontend API | `src/lib/api.ts` ~2,159 lines | Monolithic `api` object |
| Frontend pages | 50+ under `src/pages/` | Few `src/features/` extractions |
| Shared | 18 modules under `shared/` | Small; grow via `contracts/` |

**Validation baseline:** `npx tsc --noEmit` passes on `main`.

## Known import cycles (fix before large barrels)

**Server (4):**

1. `lib/metrics.ts` → `display-heartbeat-store` → `redis` → `circuit-breaker`
2. `queues/inventory-deduction.queue` → `jobs/enqueue` → `jobs/definitions`
3. `jobs/enqueue` → `jobs/definitions` → `workers/chargeAlertWorker`
4. `services/clinical-check-in` ↔ `lib/authority-cache`

**Frontend:** ~~`lib/api.ts` ↔ `lib/er-api.ts`~~ resolved in Slice 1 (`request-core.ts`)

## Migration slices (ordered)

| Slice | Description | Risk |
|-------|-------------|------|
| 0 | Architecture docs (this folder) | None |
| 1 | Break `api.ts` ↔ `er-api.ts` cycle (`request-core.ts`) | Low |
| 2 | Implement [ADR-002](./adr-002-appointments-service-split.md) service split | High |
| 3 | Extract `src/lib/api/equipment.ts` + barrel | Medium — **implemented** |
| 4 | Extract equipment route handlers (paths unchanged) | High — **reads (4a–4c)** + **mutations (4d–4l):** through bulk-delete, create, patch extracted (`equipment.ts` ≈1,386 lines). **5 inline mutations — all paused** — [inventory](./equipment-inline-mutations-inventory.md). **Do not extract** `POST /scan`, checkout, return, seen, `POST /:id/scan` without sign-off. Slice 4 handler extraction for non-paused routes is **complete**. |
| 5 | Equipment repository layer (`clinicId` param) | High |
| 6 | Split `src/types/index.ts` by domain + barrel | Medium — **6a–6b** merged; **6c** `equipment.ts` draft — [plan](./src-types-split-plan.md) |
| 7 | Group `server/app/routes.ts` registrations (no path changes) | Low |
| 8+ | Repeat per domain: containers, billing, patients, shift-handover, forecast | Varies |

Each slice must:

1. Pass `npx tsc --noEmit`
2. Run `pnpm test` (and targeted integration tests when touching clinical/financial paths)
3. Run `knip` after removals
4. Document preserved behavior in the commit message

## Rollback strategy

- One slice per PR where possible
- Keep compatibility barrels (`appointments.service.ts`, `src/lib/api.ts`) until importers migrate
- Revert single commit to roll back a slice

## Related documents

- [Architecture hardening addendum](./architecture-hardening-addendum.md) — governance, CI fitness functions, transactions, events
- [Tooling syntax verification](./tooling-syntax-verification.md) — validated CLI/config for dependency-cruiser, madge, knip, ESLint (pre-G1)
- [Domain boundaries](./domain-boundaries.md)
- [Tenant enforcement](./tenant-enforcement.md)
- [Offline & realtime invariants](./offline-realtime-invariants.md)
- [Backend routing](./backend-routing.md)
- [Frontend feature ownership](./frontend-feature-ownership.md)
- [ADR-002 — appointments service split](./adr-002-appointments-service-split.md)

## Do not touch casually

See [offline-realtime-invariants.md](./offline-realtime-invariants.md) and `CLAUDE.md` → Frozen architecture surfaces.
