# Slice 6h — ER / display / Code Blue types (`er.ts`)

**Status:** **Merged** (#589) — `src/types/er.ts` + barrel re-export.  
**Parent:** [src-types-split-plan.md](./src-types-split-plan.md) · [modularization-plan.md](./modularization-plan.md) Slice 6.

## Context

Slices **6a–6g** are merged on `main` (`platform`, `patients`, `equipment`, `tasks`, `billing`, `inventory`, `forecast`).  
`src/types/index.ts` is down to **~181 lines** — almost entirely ER, ward display, Code Blue, and crash cart types.

This slice extracts them into `src/types/er.ts` while keeping `index.ts` as a compatibility barrel (`export * from "./er.js"`).

## Explicit non-goals

| Non-goal | Rationale |
|----------|-----------|
| Runtime / API behavior changes | Types only |
| Consumer import migration (`@/types/er`) | Deferred to Slice 6i+ |
| Type renames | Frozen Phase 9 / Code Blue contracts |
| Touching `useCodeBlueSession.ts` hook-local types | `CodeBlueSession`, `CodeBlueLogEntry` stay in hook unless product asks to unify |
| F9 pilot billing work | Separate track — see [pilot-mode README](../pilot-mode/README.md) § P2.4 / F9 |
| Phase 9 transport / SW / offline emergency changes | [offline-realtime-invariants.md](./offline-realtime-invariants.md) |

## Symbols to move (~18 exports)

All currently defined inline in `src/types/index.ts` (lines ~13–181).

### Code Blue (session / API DTOs)

| Symbol | Notes |
|--------|--------|
| `CodeBlueStatus` | Ward critical equipment status enum |
| `CriticalEquipment` | Used by `src/lib/api/equipment.ts` (`getCriticalEquipment`) — **cross-file** with equipment API |
| `CodeBlueOutcome` | |
| `StartCodeBlueRequest` | `api.ts` code-blue helpers |
| `StartCodeBlueResponse` | |
| `EndCodeBlueRequest` | |
| `CodeBlueEvent` | Legacy/history shape |
| `CodeBlueLogCategory` | Display overlay log rows |
| `CodeBlueReconciliationSession` | Reconciliation page |
| `CodeBlueDispense` | Reconciliation dispense rows |

### Ward display snapshot (composite)

| Symbol | Notes |
|--------|--------|
| `DisplaySnapshotHospitalization` | Embeds inline `animal` object |
| `DisplaySnapshotEquipment` | Uses `EquipmentStatus` from `equipment.ts` |
| `DisplaySnapshotTask` | Uses `AppointmentStatus`, `TaskType` from `tasks.ts` |
| `DisplaySnapshotCodeBlueSession` | Nested log + presence |
| `DisplaySnapshot` | **Composite** — top-level ward display contract |
| `CrashCartItem` | Crash cart admin + display pill |
| `CreateCrashCartItemRequest` | |
| `UpdateCrashCartItemRequest` | |

## `er.ts` import graph (leaf-safe)

`er.ts` must **not** import from `index.ts`. Allowed `import type` only:

```ts
import type { ShiftRole } from "./platform.js";
import type { HospitalizationStatus } from "./patients.js";
import type { EquipmentStatus } from "./equipment.js";
import type { AppointmentStatus, TaskType } from "./tasks.js";
```

After extraction, `index.ts` should mirror today’s pattern:

```ts
export * from "./platform.js";
// … existing domain barrels …
export * from "./forecast.js";
export * from "./er.js";
// Remove inline ER/display definitions and remove type-only imports used only for DisplaySnapshot* (they move to er.ts).
```

**`CriticalEquipment` placement:** uses `CodeBlueStatus` only — stays in `er.ts`. `api/equipment.ts` continues `import type { CriticalEquipment } from "@/types"` via barrel.

## High-risk importers (P0–P1)

Do **not** change import paths in this slice.

| File | Symbols | Risk |
|------|---------|------|
| `src/lib/api.ts` | `DisplaySnapshot`, crash cart, Code Blue requests, reconciliation | Monolith API client |
| `src/pages/display.tsx` | All `DisplaySnapshot*` | Ward + Code Blue overlay; Phase 9 frozen UX |
| `src/hooks/useDisplaySnapshot.ts` | `DisplaySnapshot` | TanStack query + realtime invalidation |
| `src/hooks/useCodeBlueKeepaliveReconciliation.ts` | Indirect via keepalive payload | Emergency reconciliation |
| `src/lib/realtime.ts` | Gossip / keepalive (not these DTO types directly) | Do not couple type move to transport |
| `src/lib/api/equipment.ts` | `CriticalEquipment` | Already partial domain API extract |
| `src/pages/code-blue-reconciliation.tsx` | `CodeBlueReconciliationSession`, `CodeBlueDispense` | Financial alignment |
| `src/pages/crash-cart.tsx`, `crash-cart-admin-sheet.tsx` | `CrashCartItem` | |
| `src/pages/__tests__/display.empty-panes.test.tsx` | `DisplaySnapshot` | Pilot display empty state |

**Hook-local types (out of scope for 6h):** `src/hooks/useCodeBlueSession.ts` defines `CodeBlueSession`, `CodeBlueLogEntry`, `SessionPollResult` — used by live session polling, not the barrel block above.

## Frozen surfaces checklist

Before merging any 6h implementation PR, confirm:

- [ ] `/api/display/snapshot` response shape unchanged (field names, nullability)
- [ ] Code Blue mutation endpoints still typed consistently in `api.ts`
- [ ] No new imports from `er.ts` in `public/sw.js` or emergency cache paths
- [ ] `pnpm architecture:gates` — **src madge cycles remain 0**
- [ ] `npx tsc --noEmit`
- [ ] `pnpm query-keys:audit` — no new keys expected (types-only)
- [ ] Consider `tests/phase-9-drills.spec.ts` / `display.empty-panes.test.tsx` if CI scope allows

## Implementation PR checklist (when approved)

1. Create `src/types/er.ts` with moved definitions + domain imports listed above.
2. `index.ts`: add `export * from "./er.js"`; delete moved bodies; drop imports only used by moved types.
3. **No** edits under `server/`, `src/lib/api.ts` import lines, or pages except if tsc forces (should not).
4. Run validation:

```bash
pnpm architecture:gates
npx tsc --noEmit
pnpm query-keys:audit
pnpm test -- display.empty-panes
```

5. Single PR titled e.g. `refactor(types): extract er/display/Code Blue types (Slice 6h)`.

## Suggested follow-up (Slice 6i+)

| Slice | Action |
|-------|--------|
| 6i | Optional `handoff.ts` wrapper for `shared/patient-handoff-types.js` re-exports still in `platform.ts` / barrel |
| 6j+ | Pilot `import type` from `@/types/er` in `useDisplaySnapshot.ts`, `display.tsx`, `api.ts` display block — knip per PR |

## Decision log

| Date | Decision |
|------|----------|
| 2026-05-29 | 6a–6g complete; ER/display/Code Blue isolated in planning doc; implementation paused pending review |
| 2026-05-29 | F9 pilot billing on `main` documented in [#580](https://github.com/dboy3156/VetTrack/pull/580); not part of 6h |
