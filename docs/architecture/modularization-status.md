# VetTrack modularization — status & remaining work

**Last updated:** 2026-05-29  
**Canonical strategy:** [modularization-plan.md](./modularization-plan.md)  
**Branch baseline:** `main` (post–PR #591)

This document is the **single “done vs left” view** across modularization slices, frontend types split (Slice 6), equipment route extraction (Slice 4), equipment pilot (P2/P3), and architecture governance. Use it for planning; detailed inventories live in linked child docs.

---

## Executive summary

| Track | Done | Left |
|-------|------|------|
| **Architecture docs (Slice 0)** | `docs/architecture/*`, ADRs, domain boundaries, G1–G5 tooling | Keep docs in sync when slices land |
| **Frontend API cycle (Slice 1)** | `request-core.ts`; `api.ts` ↔ `er-api.ts` cycle broken | — |
| **Frontend API domains (Slice 3, 8+)** | `src/lib/api/equipment.ts` only | Monolithic `src/lib/api.ts` (~1,368 lines); other domains not extracted |
| **Equipment routes (Slice 4)** | 17 handlers extracted; reads + safe mutations | **5 inline mutations paused** (scan, checkout, return, seen, `/:id/scan`) |
| **Equipment repository (Slice 5)** | — | Not started |
| **Frontend types (Slice 6)** | **6a–6h merged** — 8 domain files + barrel | **6i+** optional: `handoff.ts`, import migrations |
| **Route registration (Slice 7)** | — | Group `server/app/routes.ts` (no path changes) |
| **Appointments service (Slice 2)** | ADR-002 written | Implementation not started (~2,186-line service) |
| **Equipment pilot (P2/P3)** | Docs **01–11 shipped** on `main` | Operational: env flags on Railway; no code slices left in plan |
| **Governance CI** | G1–G5 merged (#517–#525) | G3–G5 warn-only baselines; tighten over time |

**Frontend `src/` import cycles:** **0** (baselined in `baseline-cycles.json`).  
**Server import cycles:** **4** (documented; fix before large new barrels).

---

## Master slice table

| Slice | Description | Status | Primary reference |
|-------|-------------|--------|-------------------|
| **0** | Architecture documentation | **Done** | This folder |
| **1** | `request-core.ts` — break `api.ts` ↔ `er-api.ts` cycle | **Done** | [modularization-plan.md](./modularization-plan.md) |
| **2** | Appointments / tasks service split (ADR-002) | **Not started** | [adr-002-appointments-service-split.md](./adr-002-appointments-service-split.md) |
| **3** | Extract `src/lib/api/equipment.ts` | **Done** | `src/lib/api/equipment.ts` |
| **4** | Extract equipment route handlers | **Done (safe scope)** — 5 mutations **paused** | [equipment-inline-mutations-inventory.md](./equipment-inline-mutations-inventory.md), [slice-4-stabilization-report.md](../validation/slice-4-stabilization-report.md) |
| **5** | Equipment repository layer (`clinicId` param) | **Not started** | modularization-plan |
| **6** | Split `src/types/index.ts` by domain | **Extraction done (6a–6h)**; import migrations **6i+** | [src-types-split-plan.md](./src-types-split-plan.md) |
| **7** | Group `server/app/routes.ts` registrations | **Not started** | modularization-plan |
| **8+** | Repeat API/service splits per domain | **Partial** (equipment API only) | modularization-plan |

---

## Slice 1 — Frontend request core

### Done

- `src/lib/request-core.ts` (or equivalent) extracted so `api.ts` and `er-api.ts` no longer import each other circularly.
- **Frontend madge cycles:** 0.

### Left

- Nothing required for Slice 1 closure.

---

## Slice 2 — Appointments service (ADR-002)

### Done

- Architecture decision recorded: [adr-002-appointments-service-split.md](./adr-002-appointments-service-split.md).

### Left

- Split `server/services/appointments.service.ts` (~**2,186** lines) into focused modules.
- Preserve unified task model (`vt_appointments`, `/api/appointments`, `appointmentsPage.*` keys — **no renames**).
- High risk: medication completion, billing, inventory jobs, authority — full test matrix per ADR.

---

## Slice 3 — Frontend API: equipment

### Done

- `src/lib/api/equipment.ts` — equipment-scoped API helpers.
- Wired from main `src/lib/api.ts` barrel / object.

### Left

- Extract additional domains from `src/lib/api.ts` (~**1,368** lines): billing, patients, display/code-blue block, appointments/tasks, inventory, etc. (Slice **8+** pattern).

---

## Slice 4 — Equipment route handlers

### Done (merged)

**Scale:** `server/routes/equipment.ts` ≈ **1,386** lines (down from ~2,143). **17** handler modules under `server/routes/equipment/handlers/`.

| Category | Routes | Handler(s) | Notes |
|----------|--------|------------|--------|
| Reads | `GET /`, `/my`, `/deleted`, `/critical`, `/pilot-coverage`, `/:id`, `/:id/logs`, `/:id/transfers` | `get-equipment-*.ts` (8) | |
| Lifecycle | `POST /:id/restore`, `DELETE /:id`, `POST /:id/revert` | restore, delete, revert | Revert + version pin (F4) |
| Bulk admin | `POST /bulk-verify-room`, `/import`, `/bulk-move`, `/bulk-delete` | bulk-* + import CSV | Pilot F3, F5, etc. |
| CRUD | `POST /`, `PATCH /:id` | create, patch | Replay + offline on router |

**Invariants preserved:** middleware and replay hooks stay on `equipment.ts` router; **no path changes** (`pnpm routes:contract` 320/320).

**Stabilization:** [slice-4-stabilization-report.md](../validation/slice-4-stabilization-report.md) (Option A, 2026-05-28).

### Left (paused — do not extract without sign-off)

| # | Method | Path | Why paused |
|---|--------|------|------------|
| 1 | `POST` | `/scan` | Quick-scan; no replay; checkout/return overlap |
| 2 | `POST` | `/:id/checkout` | Waitlist, staging, V1 gates, outbox, offline |
| 3 | `POST` | `/:id/return` | Waitlist, charge-alert, returns, offline |
| 4 | `POST` | `/:id/seen` | Billing (`recordEquipmentSeen`), pilot F9 env |
| 5 | `POST` | `/:id/scan` | Replay, offline scan, undo tokens, push |

Full matrix: [equipment-inline-mutations-inventory.md](./equipment-inline-mutations-inventory.md).

### Left (other Slice 4–adjacent)

- **Slice 5:** repository layer under `server/` for equipment (explicit `clinicId` on queries) — separate high-risk slice.

---

## Slice 5 — Equipment repository

### Done

- Nothing.

### Left

- Introduce repository (or equivalent) pattern for equipment domain with **`clinicId` on every query**.
- Coordinate with paused mutations if those are ever extracted.

---

## Slice 6 — Frontend types split

### Done (6a–6h merged)

| Sub-slice | File | PR | Notes |
|-----------|------|-----|--------|
| **6a** | `src/types/platform.ts` | #571 | User, Shift, roles, audit log, support, metrics |
| **6b** | `src/types/patients.ts` | #572 | Animal, Owner, Hospitalization |
| **6c** | `src/types/equipment.ts` | #573 | Equipment, rooms, scan, ops state, alerts |
| **6d** | `src/types/tasks.ts` | #574 | Appointments / tasks / medication |
| **6e** | `src/types/billing.ts` | #575 | Ledger, leakage |
| **6f** | `src/types/inventory.ts` | #576 | Containers, PO, restock, jobs |
| **6g** | `src/types/forecast.ts` | #577 | ICU pharmacy forecast mirror |
| **6h** | `src/types/er.ts` | #589 | Code Blue, `DisplaySnapshot*`, crash cart |

**Also split earlier (pre–6a inventory):**

- `src/types/realtime-events.ts` — direct importers only (not in barrel).
- `src/types/cop-alerts.ts` — direct importers only.

**Barrel today (`src/types/index.ts`):** ~**9 lines** — `export *` from eight domains only; **no inline type definitions**.

**Planning / audit PRs:** #570 (inventory), #586 (6h plan), #580 (F9 merge audit), #591 (6h merged status).

**Incidental on `main`:** P2.4/F9 pilot billing (`10f0e463` + `4f36d6ca`) reached `main` via #577; documented in [pilot-mode README](../pilot-mode/README.md) — **keep both commits**; opt-in `PILOT_SUPPRESS_DEFAULT_BILLING=true`.

### Left (6i+ — optional, behavior-neutral)

| Sub-slice | Action | Risk | Suggested order |
|-----------|--------|------|----------------|
| **6i** | `handoff.ts` — re-export `shared/patient-handoff-types.js` | Low | When touching shift-handover |
| **6j** | `api/equipment.ts` → `@/types/equipment` | Low | **First** import migration |
| **6k+** | Migrate ~**72** `@/types` importers to `@/types/<domain>` one domain per PR | Low–medium | equipment → tasks → er → … |
| **Barrel removal** | Drop `index.ts` re-exports when knip clean | Medium | Last |

Inventory & rules: [src-types-split-plan.md](./src-types-split-plan.md).  
6h implementation notes: [slice-6h-er-display-types-plan.md](./slice-6h-er-display-types-plan.md).

**Explicit non-goals for 6i+:** no type renames; no runtime changes; no forced migration of `useCodeBlueSession` hook-local types.

---

## Slice 7 — Route registration grouping

### Done

- Nothing.

### Left

- Reorganize `server/app/routes.ts` registrations into logical groups (comments / section blocks / optional helper functions).
- **No URL or mount path changes.**
- Low risk; good next step if avoiding clinical code churn.

---

## Slice 8+ — Per-domain frontend API & backend modularization

### Done

- Equipment API partial extract (Slice 3).

### Left (examples from plan)

| Domain | Frontend (`src/lib/api/*`) | Backend routes / services |
|--------|---------------------------|---------------------------|
| Containers | Not extracted | Under `server/routes/` |
| Billing | Types only (`billing.ts`) | Routes + ledger services |
| Patients | Types only (`patients.ts`) | Routes + hospitalization |
| Shift handover | Types in platform + shared | `shift-handover.ts` |
| Forecast | Types + server mirror | Forecast routes |

Repeat pattern: extract API module → optional handler/service splits → preserve barrels until importers migrate.

---

## Equipment pilot mode (P2 / P3) — separate track

**Not part of Slice 6 numbering.** Docs: [docs/pilot-mode/README.md](../pilot-mode/README.md).

### Done (all steps shipped on `main`)

| Step | Doc | PR(s) | Theme |
|------|-----|-------|--------|
| 01 | pilot-mode override | #557 / #558 | Per-browser `localStorage` override |
| 02 | display empty panes | #559 | Ward display UX |
| 03 | rate limiter per user | #562 | Write limiter key |
| 04 | suppress English pushes | #564 | `PILOT_DISABLE_EN_PUSH` |
| 05 | suppress default billing | #563 · #577 | `PILOT_SUPPRESS_DEFAULT_BILLING` (F9) |
| 06 | bulk-delete cleanup | #561 | F3 staging reset |
| 07 | revert version pin | #565 | F4 |
| 08 | bulk-verify room version | #560 | F5 |
| 09 | emergency staging TTL | #566 | F6 |
| 10 | patch equipment strict | #567 | F7 |
| 11 | unit condition states clinic | #568 | F10 |

### Left

- **Operations:** enable/disable Railway env vars per pilot doc; monitor audits.
- **No further pilot code slices** in the current README table.

---

## Architecture governance (G1–G5)

### Done (merged 2026-05-27)

| Gate | Purpose | PR |
|------|---------|-----|
| G1 | `architecture:gates` — tsc, dependency-cruiser, madge cycles | #517 |
| G2 | CI workflow runs G1 | #522 |
| G3 | Tenant lint (warn) | #523 |
| G4 | Query-key registry audit | #524 |
| G5 | Route contract | #525 |

### Left

- Reduce warn-only baselines over time ([governance-known-limitations.md](./governance-known-limitations.md)).
- New query keys / routes require registry or contract updates when features add them.

**Standard validation for any slice:**

```bash
pnpm architecture:gates
npx tsc --noEmit
pnpm query-keys:audit    # when touching src/ query keys
pnpm routes:contract     # when touching routes/mounts
pnpm test
knip                     # after removals / export changes
```

---

## Frozen surfaces — do not modularize casually

From `CLAUDE.md` and [offline-realtime-invariants.md](./offline-realtime-invariants.md):

- **Realtime:** SSE + `vt_event_outbox` only — no WebSockets / parallel polling.
- **Code Blue:** no offline queue for emergency mutations; server-confirmed session end.
- **PWA / SW:** emergency endpoints never in Cache Storage; build-tag / BroadcastChannel contracts.
- **Authority:** evaluator `off | shadow | enforce`; Strategy A safety net retained.
- **i18n:** `appointmentsPage.*` namespace frozen (UI copy may say “Tasks”).
- **Types in `er.ts`:** moving files is fine; changing shapes or import paths for display/Code Blue requires Phase 9 discipline.

---

## Recommended “what to do next”

Priority depends on team goal; all are **independent** tracks.

| Priority | Item | Why |
|----------|------|-----|
| **A (low risk)** | **Slice 7** — group route registrations | Quick win, no behavior change |
| **B (low risk)** | **Slice 6j** — `api/equipment.ts` imports `@/types/equipment` | Completes types story incrementally |
| **C (medium)** | **Slice 8+** — next `src/lib/api/<domain>.ts` (e.g. display or appointments) | Shrinks ~1,368-line API monolith |
| **D (high)** | **Slice 2** — appointments service split | Biggest backend maintainability win |
| **E (high)** | **Slice 5** — equipment repository | Pairs with future paused-route extraction |
| **F (blocked)** | **Slice 4 remainder** — 5 paused mutations | Needs explicit product/sign-off + test matrix |

**Explicitly not recommended without approval:** extracting paused equipment mutations; renaming appointment/task internal surfaces; weakening realtime or Code Blue doctrine.

---

## Parallel product tracks (not slice numbers)

| Track | Doc | Notes |
|-------|-----|-------|
| **Asset Copilot** | [asset-copilot-implementation-plan.md](./asset-copilot-implementation-plan.md) | Evidence Resolver under `server/domain/equipment/`; **does not** depend on paused Slice 4 mutations or Slice 5; gated by **Zero Errors, Zero Breaks** + feature flags |

---

## Related documents (index)

| Document | Use |
|----------|-----|
| [modularization-plan.md](./modularization-plan.md) | Original strategy & slice definitions |
| [asset-copilot-implementation-plan.md](./asset-copilot-implementation-plan.md) | Asset Copilot milestones M0–M4 (draft) |
| [adr-003-asset-copilot-evidence-resolver.md](./adr-003-asset-copilot-evidence-resolver.md) | Resolver placement ADR |
| [src-types-split-plan.md](./src-types-split-plan.md) | Slice 6 inventory, cycles, naming traps |
| [slice-6h-er-display-types-plan.md](./slice-6h-er-display-types-plan.md) | ER/display/Code Blue extraction (merged) |
| [equipment-inline-mutations-inventory.md](./equipment-inline-mutations-inventory.md) | Paused equipment writes |
| [slice-4-stabilization-report.md](../validation/slice-4-stabilization-report.md) | Slice 4 verification record |
| [pilot-mode/README.md](../pilot-mode/README.md) | Pilot env flags & PR audit |
| [domain-boundaries.md](./domain-boundaries.md) | Domain map |
| [adr-002-appointments-service-split.md](./adr-002-appointments-service-split.md) | Slice 2 design |
| [baseline-cycles.json](./baseline-cycles.json) | Madge cycle baseline |

---

## Decision log (rollup)

| Date | Decision |
|------|----------|
| 2026-05-27 | Modularization docs + G1–G5 governance merged |
| 2026-05-28 | Slice 4 safe handler extraction complete; 5 mutations paused |
| 2026-05-29 | Slice 6a–6h types extraction complete; barrel-only `index.ts` |
| 2026-05-29 | Pilot P2/P3 docs 01–11 shipped; F9 billing documented (#580) |
| 2026-05-29 | This status doc added as consolidated done/left view |
