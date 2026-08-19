# VetTrack — Frontend Route Inventory

All routes from `src/app/routes.tsx`. Page components are lazy-loaded via `React.lazy()` unless noted.

Generated 2026-08-19.

---

## Public

| Path | Component | Notes |
|------|-----------|-------|
| `/` | `RootRoute` | public |
| `/signin/*?` | `pages/signin` | public |
| `/signup/*?` | `pages/signup` | public |

## Home

| Path | Component | Notes |
|------|-----------|-------|
| `/home` | `pages/home` | AuthGuard |

## Equipment (canonical)

| Path | Component | Notes |
|------|-----------|-------|
| `/equipment` | `pages/equipment-list` | AuthGuard |
| `/equipment/new` | `pages/new-equipment` | AuthGuard |
| `/equipment/tasks` | `pages/Tasks` | AuthGuard |
| `/equipment/:id/edit` | `pages/new-equipment` | AuthGuard |
| `/equipment/:id/qr` | `pages/equipment-qr-print` | AuthGuard |
| `/equipment/:id?` | `features/equipment/tablet/EquipmentMasterDetail` | AuthGuard |
| `/equipment/:id` | `pages/equipment-detail` | AuthGuard |
| `/alerts` | `pages/alerts` | AuthGuard |
| `/my-equipment` | `pages/my-equipment` | AuthGuard |
| `/rooms` | `pages/rooms-list` | AuthGuard |
| `/rooms/:id` | `pages/room-radar` | AuthGuard |
| `/locations` | `pages/rooms-list` | AuthGuard |
| `/locations/:id` | `pages/room-radar` | AuthGuard |
| `/print` | `pages/qr-print` | AuthGuard |

## Legacy equipment redirects

| Path | Component | Notes |
|------|-----------|-------|
| `/equipment/board` | Redirect | → `/board` |
| `/equipment/scan` | Redirect | → `/equipment?scan=1` |
| `/equipment/maintenance` | Redirect | → `/equipment?status=maintenance` |
| `/equipment/intelligence` | Redirect | → `/equipment` |
| `/appointments` | Redirect | → `/equipment/tasks` |
| `/equipment-tasks` | Redirect | → `/equipment/tasks` |
| `/display` | Redirect | → `/board` |
| `/equipment-board` | Redirect | → `/board` |
| `/scan` | `pages/scan` | AuthGuard |

## Emergency & safety

| Path | Component | Notes |
|------|-----------|-------|
| `/code-blue` | `pages/code-blue` | AuthGuard |
| `/code-blue/display` | `pages/code-blue-display` | AuthGuard |
| `/crash-cart` | `pages/crash-cart` | AuthGuard |
| `/handoff` | `pages/handoff` | AuthGuard |
| `/admin/code-blue-history` | `pages/code-blue-history` | AuthGuard |
| `/emergency-equipment-log` | `pages/code-blue` | AuthGuard |
| `/emergency-equipment-wall` | `pages/code-blue-display` | AuthGuard |
| `/critical-kit-check` | `pages/crash-cart` | AuthGuard |
| `/emergency-equipment-history` | `pages/code-blue-history` | AuthGuard |

## Admin & settings

| Path | Component | Notes |
|------|-----------|-------|
| `/admin` | `pages/admin` | AuthGuard |
| `/admin/shifts` | `pages/admin-shifts` | AuthGuard |
| `/admin/asset-types` | `pages/AdminAssetTypesPage` | AuthGuard |
| `/admin/docks` | `pages/AdminDocksPage` | AuthGuard |
| `/admin/home-assignment` | `pages/AdminHomeAssignmentPage` | AuthGuard |
| `/admin/metrics` | `pages/OperationalMetricsDashboardPage` | AuthGuard |
| `/admin/integrations` | `pages/console/IntegrationsConsolePage` | AuthGuard |
| `/admin/webhooks` | `pages/console/WebhooksConsolePage` | AuthGuard |
| `/admin/notifications` | `pages/console/NotificationsConsolePage` | AuthGuard |
| `/admin/rfid-readers` | `pages/console/RfidReadersConsolePage` | AuthGuard |
| `/admin/governance` | `pages/console/GovernanceConsolePage` | AuthGuard |
| `/admin/audit-log` | `pages/console/AuditConsolePage` | AuthGuard |
| `/admin/inventory` | `pages/console/InventoryConsolePage` | AuthGuard |
| `/admin/people` | `pages/console/PeopleRolesConsolePage` | AuthGuard |
| `/admin/displays` | `pages/console/DisplaysConsolePage` | AuthGuard |
| `/settings` | `pages/settings` | AuthGuard |
| `/help` | `pages/help` | AuthGuard |
| `/audit-log` | `pages/audit-log` | AuthGuard |
| `/admin/medication-integrity` | Redirect | → `/admin` |

## Platform & analytics

| Path | Component | Notes |
|------|-----------|-------|
| `/inventory` | `pages/inventory-page` | AuthGuard |
| `/inventory-items` | `pages/inventory-items` | AuthGuard |
| `/procurement` | `pages/procurement` | AuthGuard |
| `/analytics/shift-leaderboard` | `pages/shift-leaderboard` | AuthGuard |
| `/analytics` | `pages/analytics` | AuthGuard |
| `/dashboard` | `pages/management-dashboard` | AuthGuard |
| `/whats-new` | `pages/whats-new` | AuthGuard |
| `/shift-chat/:shiftId` | `features/shift-chat/components/ShiftChatArchive` | AuthGuard |

## Legacy redirects (removed pages)

| Path | Component | Notes |
|------|-----------|-------|
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

## Other

| Path | Component | Notes |
|------|-----------|-------|
| `/privacy` | `pages/privacy-policy` | public |
| `/terms` | `pages/terms-of-use` | public |
| `/support` | `pages/support` | public |
| `/account-deletion` | `pages/account-deletion` | public |
| `/board` | `BoardRoute` | public |
| `/board/pair` | `pages/board-pair` | public |
| `/my-profile` | `pages/my-profile` | AuthGuard |
| `/rooms/:id?` | `native/tablet/RoomsMasterDetail` | AuthGuard |
| `/locations/:id?` | `native/tablet/RoomsMasterDetail` | AuthGuard |
| `/autopilot/queue` | `pages/autopilot-queue` | AuthGuard |
| `/ops/health` | `pages/console/OpsHealthConsolePage` | AuthGuard |
| `/inventory-items/:id?` | `native/tablet/InventoryItemsMasterDetail` | AuthGuard |
| `/inventory-items/:id` | `pages/inventory-item-detail` | AuthGuard |
