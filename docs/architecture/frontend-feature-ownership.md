# Frontend feature ownership

## Current layout

| Area | Location | Notes |
|------|----------|-------|
| Routes | `src/app/routes.tsx` | Lazy `import()` per page; pilot/ER guards |
| Pages | `src/pages/*.tsx` | Most UI still here (~50 files) |
| Features | `src/features/*` | Partial: auth, shift-chat, containers, er, inventory reducer |
| API client | `src/lib/api.ts` | ~2,159 lines; `export const api = { … }` |
| ER client | `src/lib/er-api.ts` | Circular import with `api.ts` — fix in slice 1 |
| Types | `src/types/index.ts` | ~159 exports — split with barrel |
| Hooks | `src/hooks/*` | Cross-cutting; domain hooks should move under `features/<domain>/hooks` |
| Realtime | `src/lib/realtime.ts`, `useRealtime*.ts` | Frozen transport assumptions |
| Offline | `src/lib/offline-db.ts`, `sync-engine.ts` | Dexie + FIFO replay |

## Target feature structure

```
src/features/<domain>/
  api/           # thin wrappers; re-export from lib/api during migration
  hooks/         # TanStack Query — preserve query keys
  components/
  pages/         # move from src/pages/ when slice is ready
  realtime/      # only if domain-specific (e.g. equipment bridge)
  offline/       # only if domain-specific enqueue helpers
  types.ts
  index.ts       # minimal public surface — avoid fat barrels
```

## API extraction rules

1. Extract one namespace at a time (e.g. `api.equipment` → `src/lib/api/equipment.ts`)
2. Keep `src/lib/api.ts` as compatibility barrel until importers migrate
3. Do not change URL paths, methods, or `request()` offline/retry semantics
4. Preserve `EQUIPMENT_LIST_FETCH_TIMEOUT_MS`, `TASKS_FETCH_TIMEOUT_MS`, auth headers, 401 → `/signin` behavior

## TanStack Query rules

- **Do not rename query keys** without auditing invalidation (`queryClient.invalidateQueries`, `equipment-realtime.ts`, etc.)
- ER mode: `ER_MODE_QUERY_KEY` in `er-api.ts` — shared by guard and layout
- Prefer colocating keys in `features/<domain>/hooks/query-keys.ts` when migrating
- G4 audit baseline: `src/lib/query-keys/registry.ts` (not imported at runtime); run `pnpm query-keys:audit` after adding keys

## Import boundaries

```
pages/features → @/lib/api (or feature api)
features → @/components/ui, @/lib/i18n
features → shared/ (types only)
❌ features → server/
❌ shared → src/ or server/
```

## Oversized pages (migration candidates)

| Page | ~Lines | Domain |
|------|-------:|--------|
| `admin.tsx` | 2,424 | platform/admin |
| `equipment-detail.tsx` | 2,154 | equipment |
| `appointments.tsx` | 1,778 | tasks |
| `shift-handover-page.tsx` | 1,714 | scheduling |
| `layout.tsx` | 1,535 | shell (extract carefully) |

Split UI incrementally: components first, then hooks, then page thin wrapper.

## Pilot & ER guards

- `isPilotMode` from `@/lib/pilot-mode` — hides routes in `routes.tsx`
- `ErModeGuard` / `features/er` — must stay consistent with server concealment 404

## Verification

- `npx tsc --noEmit`
- `pnpm test` (offline, pwa, conflict suites when touching sync)
- Manual: equipment list offline fallback, sign-in redirect on 401

## Recommended frontend slice order

1. Break `api` ↔ `er-api` cycle
2. Extract `api.equipment`
3. Move `equipment-detail` subcomponents to `features/equipment/components`
4. Extract `api.tasks` / `api.appointments` after backend ADR-002
