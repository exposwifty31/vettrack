# VetTrack — Frontend Route Inventory

All routes from `src/app/routes.tsx`. All page components are lazy-loaded via `React.lazy()`. Generated 2026-06-09.

---

## Public (no auth)

| Path | Component | Notes |
|------|-----------|-------|
| `/` | `RootRoute` | Root redirect: authenticated → `/home`; new signup → post-signup flow; otherwise → `/landing` |
| `/landing` | `LandingPage` | Public marketing landing |
| `/signin/*?` | `SignInPage` | Clerk sign-in |
| `/signup/*?` | `SignUpPage` | Clerk sign-up |

---

## Home & Shifts

| Path | Component | Notes |
|------|-----------|-------|
| `/home` | `HomePage` | Home dashboard with urgent banner (Code Blue > critical alert > overdue) |
| `/recap` | `ShiftRecapPage` | Shift recap/handover summary |

---

## Equipment (canonical paths)

| Path | Component | Notes |
|------|-----------|-------|
| `/equipment` | `EquipmentPage` | Equipment list, search, filter, QR scan |
| `/equipment/new` | `NewEquipmentPage` | Create new equipment |
| `/equipment/tasks` | `AppointmentsPage` | Unified task model (canonical; T2.3) |
| `/equipment/board` | `WardDisplayPage` | Ward display board (canonical; T2.3) |
| `/equipment/:id` | `EquipmentDetailPage` | Equipment detail |
| `/equipment/:id/edit` | `NewEquipmentPage` | Edit equipment |
| `/equipment/:id/qr` | `EquipmentQrPrintPage` | QR code print |
| `/my-equipment` | `MyEquipmentPage` | My equipment (checked-out to me) |
| `/alerts` | `AlertsPage` | Active alerts dashboard |
| `/rooms` | `RoomsListPage` | Rooms/locations list |
| `/rooms/:id` | `RoomRadarPage` | Room radar view |
| `/locations` | `RoomsListPage` | Alias for `/rooms` |
| `/locations/:id` | `RoomRadarPage` | Alias for `/rooms/:id` |
| `/print` | `QrPrintPage` | Bulk QR print |

### Legacy equipment redirects

| Old path | Redirects to |
|----------|-------------|
| `/appointments` | `/equipment/tasks` |
| `/equipment-tasks` | `/equipment/tasks` |
| `/display` | `/equipment/board` |
| `/equipment-board` | `/equipment/board` |
| `/scan` | `/equipment?scan=1` |
| `/equipment/scan` | `/equipment?scan=1` |
| `/equipment/maintenance` | `/equipment?status=maintenance` |
| `/equipment/intelligence` | `/equipment` |

---

## Emergency & Safety

| Path | Component | Notes |
|------|-----------|-------|
| `/code-blue` | `CodeBluePage` | Code Blue session start/management |
| `/code-blue/display` | `CodeBlueDisplay` | Code Blue live display |
| `/crash-cart` | `CrashCartCheckPage` | Crash cart verification |
| `/admin/code-blue-history` | `CodeBlueHistoryPage` | Code Blue session history |

### Legacy emergency aliases (still active)

| Old path | Resolves to |
|----------|------------|
| `/emergency-equipment-log` | `CodeBluePage` |
| `/emergency-equipment-wall` | `CodeBlueDisplay` |
| `/critical-kit-check` | `CrashCartCheckPage` |
| `/emergency-equipment-history` | `CodeBlueHistoryPage` |

---

## Admin & Settings

| Path | Component | Notes |
|------|-----------|-------|
| `/admin` | `AdminPage` | Admin home |
| `/admin/shifts` | `AdminShiftsPage` | Shift management |
| `/admin/ops-dashboard` | `AdminOpsDashboardPage` | Operations dashboard |
| `/admin/asset-types` | `AdminAssetTypesPage` | Asset type config |
| `/admin/docks` | `AdminDocksPage` | Dock configuration |
| `/admin/metrics` | `OperationalMetricsDashboardPage` | Operational metrics |
| `/settings` | `SettingsPage` | User settings |
| `/help` | `HelpPage` | Help / documentation |
| `/stability` | `StabilityDashboardPage` | Stability dashboard |
| `/audit-log` | `AuditLogPage` | Audit log viewer |
| `/admin/medication-integrity` | → `/admin` | Redirect (deprecated route) |

---

## Platform & Analytics

| Path | Component | Notes |
|------|-----------|-------|
| `/inventory` | `InventoryPage` | Inventory dashboard |
| `/inventory-items` | `InventoryItemsPage` | Inventory item management |
| `/procurement` | `ProcurementPage` | Purchase orders |
| `/analytics/outcome-kpi` | `OutcomeKpiDashboardPage` | Outcome KPI dashboard |
| `/analytics/shift-leaderboard` | `ShiftLeaderboardPage` | Shift leaderboard |
| `/analytics` | `AnalyticsPage` | Analytics overview |
| `/dashboard` | `ManagementDashboardPage` | Management dashboard |
| `/whats-new` | `WhatsNewPage` | Changelog / what's new |
| `/shift-chat/:shiftId` | `ShiftChatArchive` | Shift chat archive |
| `/app-tour` | `AppTourPage` | Guided app tour |

### Legacy platform redirects

| Old path | Redirects to |
|----------|-------------|
| `/meds` | `/equipment/tasks` |
| `/pharmacy-forecast` | `/equipment/tasks` |
| `/patients` | `/equipment` |
| `/patients/:id` | `/equipment` |
| `/pending` | `/equipment` |
| `/billing` | `/equipment` |
| `/billing/:rest*` | `/equipment` |
| `/er` | `/equipment` |
| `/er/:rest*` | `/equipment` |
| `/shift-handover` | `/equipment` |
| `/pending-emergencies` | `/equipment` |

---

## 404

| Path | Component |
|------|-----------|
| `*` | `NotFoundPage` |

---

## Summary

| Category | Live routes | Redirects |
|----------|------------|-----------|
| Public | 4 | — |
| Home/Shifts | 2 | — |
| Equipment | 14 | 8 |
| Emergency | 4 | 4 |
| Admin/Settings | 11 | 1 |
| Platform | 10 | 11 |
| 404 | 1 | — |
| **Total** | **46** | **24** |
