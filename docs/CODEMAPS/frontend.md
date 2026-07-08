# Frontend Codemap
<!-- Generated: 2026-07-08 | 51 lazy pages, 82 routes, 13 feature modules | Token estimate: ~750 -->

React 18 + Vite (port 5000). Router: wouter, all pages lazy-loaded. **82 `<Route>`, 51 lazy page components.** Full route inventory: [`docs/audit/frontend-routes.md`](../audit/frontend-routes.md).

## Shell selection (the seam)
```
src/app/platform/PlatformRouter.tsx
  mobile   → src/native/NativeShell   (tab bar, MoreSheet, safe-area)
  board    → src/board/BoardShell     (kiosk: wake-lock, error boundary, auto-reload)
  desktop  → passthrough → each page's own AppShell (web chrome)
  marketing→ passthrough
```
Guards mount inside `AuthGuard`: `WebOnlyGuard` (fences desktop-dense surfaces), `ManagementGuard` (console capability gate).

## Directory map
| Path | Role |
|------|------|
| `src/app/` | router (`routes.tsx`), platform seam |
| `src/pages/` | 51 route-level components (lazy) |
| `src/features/` | 13 modules: alerts, auth, command-board, containers, equipment, inventory, profile, rooms, scan, settings, shift-adjustments, shift-chat, today |
| `src/components/` | shared UI; `components/ui/` = shadcn primitives |
| `src/core/` + `src/infrastructure/` | hexagonal client domain (in-progress migration) |
| `src/native/` `src/desktop/` `src/board/` | platform shells |
| `src/desktop/management/` | console primitives (DataTable, ManagementGuard, ReadOnlyChip) — Phase 6 |
| `src/lib/` | `api.ts`, `offline-db.ts` (Dexie), `sync-engine.ts`, `i18n.ts`, `auth-fetch.ts` |
| `src/hooks/` | auth, push, `use-experience.ts` |

## Per-role experience (Phase 2–3)
`src/lib/roles/experience-model.ts` (pure TS): `UserRole` (7) → `ExperienceArchetype` (5, total map) + `Capability` closed union + `can()`. Consumed via `src/hooks/use-experience.ts`. Home forks on `homeSurface`: `home.tsx` → `OpsHomeSurface` (admin/lead) vs `FloorHomeSurface` (vet/tech/student). Shift elevation overlays **capabilities only**, never home/nav shape.

## Command board (Phase 4–5)
`src/features/command-board/CommandBoardScreen.tsx` — SSE connect/replay + `useDisplaySnapshot` (5s/2s poll) + heartbeat + gossip, wired **once**. `WardDisplayPage` (`/equipment/board`) and `/board` both render it. Presentational: `CommandBoard`, `CodeBlueOverlay`, `board-panels` (Power/Docks/Waitlist/Staging, tolerant-reader), `use-board-mode` (calm/pressure, exit-only hysteresis).

## State management
| Concern | Tool |
|---------|------|
| Server state | TanStack Query (`src/lib/api.ts`) |
| Offline | Dexie (`offline-db.ts`) + `sync-engine.ts` (FIFO, circuit-breaker) |
| Realtime | SSE + `BroadcastChannel` cross-tab gossip |
| PWA | `public/sw.js`, cache `vettrack-<__VT_BUILD_TAG__>` |

## Data fetching contract
Every endpoint: typed fn in `src/lib/api.ts` + type in `src/types/`. Emergency mutations are **never** queued offline (`classifyEmergencyEndpoint` in `offline-emergency-block.ts`).

## i18n
`t` from `@/lib/i18n` (typed, hand-built accessor). Hebrew default + RTL-first. Parity enforced (`pnpm i18n:check`). **Zero hardcoded strings** — `tests/i18n-no-hebrew-in-source.test.ts` rejects Hebrew in `.ts/.tsx`.
