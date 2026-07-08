# VetTrack — Frontend Route Inventory

All routes from `src/app/routes.tsx`. Page components are lazy-loaded via `React.lazy()` unless noted.

Generated 2026-07-08.

---

## Public

| Path | Component | Notes |
|------|-----------|-------|
| `/` | `RootRoute` | AuthGuard |

## Equipment (canonical)

| Path | Component | Notes |
|------|-----------|-------|
| `/equipment` | `AuthGuard` | AuthGuard |
| `/equipment/new` | `AuthGuard` | AuthGuard |
| `/equipment/tasks` | `AuthGuard` | AuthGuard |
| `/equipment/board` | `AuthGuard` | AuthGuard |
| `/equipment/:id/edit` | `AuthGuard` | AuthGuard |
| `/equipment/:id/qr` | `AuthGuard` | AuthGuard |
| `/equipment/:id?` | `AuthGuard` | AuthGuard |
| `/equipment/:id` | `AuthGuard` | AuthGuard |
| `/alerts` | `AuthGuard` | AuthGuard |
| `/my-equipment` | `AuthGuard` | AuthGuard |
| `/rooms` | `AuthGuard` | AuthGuard |
| `/rooms/:id` | `AuthGuard` | AuthGuard |
| `/locations` | `AuthGuard` | AuthGuard |
| `/locations/:id` | `AuthGuard` | AuthGuard |
| `/print` | `AuthGuard` | AuthGuard |

## Legacy equipment redirects

| Path | Component | Notes |
|------|-----------|-------|
| `/appointments` | Redirect | → `/equipment/tasks` |
| `/equipment-tasks` | Redirect | → `/equipment/tasks` |
| `/display` | Redirect | → `/equipment/board` |
| `/equipment-board` | Redirect | → `/equipment/board` |
| `/scan` | `AuthGuard` | AuthGuard |
| `/equipment/scan` | Redirect | → `/equipment?scan=1` |
| `/equipment/maintenance` | Redirect | → `/equipment?status=maintenance` |
| `/equipment/intelligence` | Redirect | → `/equipment` |

## Emergency & safety

| Path | Component | Notes |
|------|-----------|-------|
| `/code-blue` | `AuthGuard` | AuthGuard |
| `/code-blue/display` | `AuthGuard` | AuthGuard |
| `/crash-cart` | `AuthGuard` | AuthGuard |
| `/handoff` | `AuthGuard` | AuthGuard |
| `/admin/code-blue-history` | `AuthGuard` | AuthGuard |
| `/emergency-equipment-log` | `AuthGuard` | AuthGuard |
| `/emergency-equipment-wall` | `AuthGuard` | AuthGuard |
| `/critical-kit-check` | `AuthGuard` | AuthGuard |
| `/emergency-equipment-history` | `AuthGuard` | AuthGuard |

## Admin & settings

| Path | Component | Notes |
|------|-----------|-------|
| `/admin/code-blue-history` | `AuthGuard` | AuthGuard |
| `/admin` | `AuthGuard` | AuthGuard |
| `/admin/shifts` | `AuthGuard` | AuthGuard |
| `/admin/asset-types` | `AuthGuard` | AuthGuard |
| `/admin/docks` | `AuthGuard` | AuthGuard |
| `/admin/metrics` | `AuthGuard` | AuthGuard |
| `/admin/integrations` | `AuthGuard` | AuthGuard |
| `/admin/webhooks` | `AuthGuard` | AuthGuard |
| `/admin/notifications` | `AuthGuard` | AuthGuard |
| `/admin/rfid-readers` | `AuthGuard` | AuthGuard |
| `/settings` | `AuthGuard` | AuthGuard |
| `/help` | `AuthGuard` | AuthGuard |
| `/audit-log` | `AuthGuard` | AuthGuard |
| `/admin/medication-integrity` | Redirect | → `/admin` |

## Platform & analytics

| Path | Component | Notes |
|------|-----------|-------|
| `/inventory` | `AuthGuard` | AuthGuard |
| `/inventory-items` | `AuthGuard` | AuthGuard |
| `/procurement` | `AuthGuard` | AuthGuard |
| `/analytics/shift-leaderboard` | `AuthGuard` | AuthGuard |
| `/analytics` | `AuthGuard` | AuthGuard |
| `/dashboard` | `AuthGuard` | AuthGuard |
| `/whats-new` | `AuthGuard` | AuthGuard |
| `/shift-chat/:shiftId` | `AuthGuard` | AuthGuard |

## Legacy redirects (removed pages)

| Path | Component | Notes |
|------|-----------|-------|
| `/admin/medication-integrity` | Redirect | → `/admin` |
| `/analytics/outcome-kpi` | Redirect | → `/analytics` |
| `/stability` | Redirect | → `/home` |
| `/app-tour` | Redirect | → `/home` |
| `/meds` | Redirect | → `/equipment/tasks` |
| `/pharmacy-forecast` | Redirect | → `/equipment/tasks` |
| `/patients` | Redirect | → `/equipment` |
| `/patients/:id` | Redirect | → `/equipment` |
| `/pending` | Redirect | → `/equipment` |
| `/billing` | Redirect | → `/equipment` |
| `/billing/:rest*` | Redirect | → `/equipment` |
| `/er` | Redirect | → `/equipment` |
| `/er/:rest*` | Redirect | → `/equipment` |
| `/shift-handover` | Redirect | → `/equipment` |
| `/pending-emergencies` | Redirect | → `/equipment` |
