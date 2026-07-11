import { Redirect, Route, Switch, useSearch } from "wouter";
import { lazy } from "react";
import { AuthGuard } from "@/features/auth/components/AuthGuard";
import { AuthBootstrapSpinner } from "@/components/native-clerk-gate";
import { RouteFallback } from "@/components/route-fallback";
import { PageErrorBoundary } from "@/components/ui/page-error-boundary";
import { useAuth } from "@/hooks/use-auth";
import { isCapacitorNative } from "@/lib/capacitor-runtime";
import { WebOnlyGuard } from "@/app/platform/guards/WebOnlyGuard";
import { CustodyGuard } from "@/app/platform/guards/CustodyGuard";
import { ManagementGuard } from "@/desktop/management";
import { useIsNativeTablet } from "@/native/tablet/useIsNativeTablet";
import { hasStoredDisplayToken } from "@/lib/display-token-store";

const CLERK_ENABLED = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

// --- Always-available pages ---
const HomePage = lazy(() => import("@/pages/home"));
const SignUpPage = lazy(() => import("@/pages/signup"));
const SignInPage = lazy(() => import("@/pages/signin"));
const PrivacyPolicyPage = lazy(() => import("@/pages/privacy-policy"));
const TermsOfUsePage = lazy(() => import("@/pages/terms-of-use"));
const SupportPage = lazy(() => import("@/pages/support"));
const EquipmentPage = lazy(() => import("@/pages/equipment-list"));
const EquipmentDetailPage = lazy(() => import("@/pages/equipment-detail"));
const EquipmentMasterDetail = lazy(() => import("@/features/equipment/tablet/EquipmentMasterDetail"));
const NewEquipmentPage = lazy(() => import("@/pages/new-equipment"));
const AlertsPage = lazy(() => import("@/pages/alerts"));
const MyEquipmentPage = lazy(() => import("@/pages/my-equipment"));
const RoomsListPage = lazy(() => import("@/pages/rooms-list"));
const RoomRadarPage = lazy(() => import("@/pages/room-radar"));
const RoomsMasterDetail = lazy(() => import("@/features/rooms/tablet/RoomsMasterDetail"));
const QrPrintPage = lazy(() => import("@/pages/qr-print"));
const EquipmentQrPrintPage = lazy(() => import("@/pages/equipment-qr-print"));
const AdminPage = lazy(() => import("@/pages/admin"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const HelpPage = lazy(() => import("@/pages/help"));
const CodeBluePage = lazy(() => import("@/pages/code-blue"));
const CodeBlueDisplay = lazy(() => import("@/pages/code-blue-display"));
const CrashCartCheckPage = lazy(() => import("@/pages/crash-cart"));
const CodeBlueHistoryPage = lazy(() => import("@/pages/code-blue-history"));
const CommandBoardScreen = lazy(() => import("@/features/command-board"));
const BoardPairPage = lazy(() => import("@/pages/board-pair"));
const HandoffPage = lazy(() => import("@/pages/handoff"));
const NotFoundPage = lazy(() => import("@/pages/not-found"));
const ScanPage = lazy(() => import("@/pages/scan"));

// --- Platform pages ---
const InventoryPage = lazy(() => import("@/pages/inventory-page"));
const AnalyticsPage = lazy(() => import("@/pages/analytics"));
const ManagementDashboardPage = lazy(() => import("@/pages/management-dashboard"));
const AdminShiftsPage = lazy(() => import("@/pages/admin-shifts"));
const AdminAssetTypesPage = lazy(() => import("@/pages/AdminAssetTypesPage"));
const AdminDocksPage = lazy(() => import("@/pages/AdminDocksPage"));
const OperationalMetricsDashboardPage = lazy(() => import("@/pages/OperationalMetricsDashboardPage"));
const AppointmentsPage = lazy(() => import("@/pages/Tasks"));
const AuditLogPage = lazy(() => import("@/pages/audit-log"));
const WhatsNewPage = lazy(() => import("@/pages/whats-new"));
const ShiftLeaderboardPage = lazy(() => import("@/pages/shift-leaderboard"));
const InventoryItemsPage = lazy(() => import("@/pages/inventory-items"));
const InventoryItemDetailPage = lazy(() => import("@/pages/inventory-item-detail"));
const InventoryItemsMasterDetail = lazy(() => import("@/features/inventory/tablet/InventoryItemsMasterDetail"));
const ProcurementPage = lazy(() => import("@/pages/procurement"));
const ShiftChatArchive = lazy(() =>
  import("@/features/shift-chat/components/ShiftChatArchive").then((m) => ({ default: m.ShiftChatArchive }))
);
const MyProfilePage = lazy(() => import("@/pages/my-profile"));
// --- Web management console (Phase 6) ---
const IntegrationsConsolePage = lazy(() => import("@/pages/console/IntegrationsConsolePage"));
const WebhooksConsolePage = lazy(() => import("@/pages/console/WebhooksConsolePage"));
const NotificationsConsolePage = lazy(() => import("@/pages/console/NotificationsConsolePage"));
const RfidReadersConsolePage = lazy(() => import("@/pages/console/RfidReadersConsolePage"));
const GovernanceConsolePage = lazy(() => import("@/pages/console/GovernanceConsolePage"));
const AuditConsolePage = lazy(() => import("@/pages/console/AuditConsolePage"));
const InventoryConsolePage = lazy(() => import("@/pages/console/InventoryConsolePage"));
const OpsHealthConsolePage = lazy(() => import("@/pages/console/OpsHealthConsolePage"));
const PeopleRolesConsolePage = lazy(() => import("@/pages/console/PeopleRolesConsolePage"));
const DisplaysConsolePage = lazy(() => import("@/pages/console/DisplaysConsolePage"));

export function RedirectPreserveSearch({ to }: { to: string }) {
  const search = useSearch();
  const query = search ? (search.startsWith("?") ? search : `?${search}`) : "";
  return <Redirect to={`${to}${query}`} replace />;
}

/** `/` — signed-in users go to `/home`; everyone else goes to `/signin`. */
function RootRoute() {
  const { isLoaded, isSignedIn, isOfflineSession } = useAuth();

  if (isCapacitorNative() && CLERK_ENABLED && !isOfflineSession && !isSignedIn) {
    return <Redirect to="/signin" replace />;
  }

  if (!isLoaded && !isOfflineSession) {
    return isCapacitorNative() ? <AuthBootstrapSpinner /> : <RouteFallback />;
  }

  if (isSignedIn) {
    return <Redirect to="/home" replace />;
  }

  return <Redirect to="/signin" replace />;
}

export function AppRoutes() {
  // iPad (native tablet) uses combined `/base/:id?` routes so the master list
  // stays mounted while the detail pane swaps; phone/web keep separate routes.
  const isNativeTablet = useIsNativeTablet();
  // Phase 9 — a paired display device (device token in localStorage, no Clerk
  // user) may view /board without AuthGuard. The stored token still authorizes
  // every board data request server-side; AuthGuard stays for normal users.
  const isDisplayPaired = hasStoredDisplayToken();
  return (
    <PageErrorBoundary fallbackLabel="Page rendering failed">
      <Switch>

        {/* --- Auth & landing --- */}
        <Route path="/" component={RootRoute} />
        <Route path="/signin/*?" component={SignInPage} />
        <Route path="/signup/*?" component={SignUpPage} />
        <Route path="/privacy" component={PrivacyPolicyPage} />
        <Route path="/terms" component={TermsOfUsePage} />
        <Route path="/support" component={SupportPage} />

        {/* --- Today & shifts --- */}
        <Route path="/home"><AuthGuard><HomePage /></AuthGuard></Route>

        {/* --- Equipment & board (canonical: /equipment, /equipment/tasks, /equipment/board) --- */}
        {/* iPad: single combined route (below, after the reserved siblings) keeps the list mounted. */}
        {!isNativeTablet && <Route path="/equipment"><AuthGuard><EquipmentPage /></AuthGuard></Route>}
        <Route path="/equipment/new"><AuthGuard><NewEquipmentPage /></AuthGuard></Route>
        <Route path="/equipment/tasks"><AuthGuard><AppointmentsPage /></AuthGuard></Route>
        {/* Phase 10: /board is the canonical Command Center (BoardShell kiosk). The
            legacy /equipment/board web route redirects to it (owner decision), so
            there is one board surface. Bookmarks/deep-links + ?kiosk=1 preserved. */}
        <Route path="/equipment/board"><RedirectPreserveSearch to="/board" /></Route>
        {/* Standalone Command Center kiosk. AuthGuard only — the platform target */}
        {/* already does the gating WebOnlyGuard would: native → mobile (NativeShell), */}
        {/* narrow browser at /board → board (full BoardShell kiosk, not the desktop */}
        {/* interstitial). BoardShell (via PlatformRouter) owns the dark kiosk chrome. */}
        <Route path="/board">
          {isDisplayPaired
            ? <CommandBoardScreen kioskMode />
            : <AuthGuard><CommandBoardScreen kioskMode /></AuthGuard>}
        </Route>
        {/* Display-device pairing kiosk. NO AuthGuard — a headless display has no */}
        {/* Clerk user; it redeems a pairing code for a device token, then → /board. */}
        {/* Matches isBoardPathname (/board/*) so it renders inside BoardShell. */}
        <Route path="/board/pair"><BoardPairPage /></Route>
        <Route path="/equipment/:id/edit"><AuthGuard><NewEquipmentPage /></AuthGuard></Route>
        <Route path="/equipment/:id/qr"><AuthGuard><WebOnlyGuard><EquipmentQrPrintPage /></WebOnlyGuard></AuthGuard></Route>
        {isNativeTablet
          ? <Route path="/equipment/:id?"><AuthGuard><EquipmentMasterDetail /></AuthGuard></Route>
          : <Route path="/equipment/:id"><AuthGuard><EquipmentDetailPage /></AuthGuard></Route>}
        {/* Legacy aliases → canonicals */}
        <Route path="/appointments"><Redirect to="/equipment/tasks" replace /></Route>
        <Route path="/equipment-tasks"><Redirect to="/equipment/tasks" replace /></Route>
        <Route path="/display"><RedirectPreserveSearch to="/board" /></Route>
        <Route path="/equipment-board"><RedirectPreserveSearch to="/board" /></Route>
        <Route path="/scan"><AuthGuard><ScanPage /></AuthGuard></Route>
        <Route path="/equipment/scan"><Redirect to="/equipment?scan=1" replace /></Route>
        <Route path="/equipment/maintenance"><Redirect to="/equipment?status=maintenance" replace /></Route>
        <Route path="/equipment/intelligence"><Redirect to="/equipment" replace /></Route>
        <Route path="/alerts"><AuthGuard><CustodyGuard><AlertsPage /></CustodyGuard></AuthGuard></Route>
        <Route path="/my-equipment"><AuthGuard><MyEquipmentPage /></AuthGuard></Route>
        <Route path="/my-profile"><AuthGuard><MyProfilePage /></AuthGuard></Route>
        {isNativeTablet && <Route path="/rooms/:id?"><AuthGuard><CustodyGuard><RoomsMasterDetail /></CustodyGuard></AuthGuard></Route>}
        {!isNativeTablet && <Route path="/rooms"><AuthGuard><CustodyGuard><RoomsListPage /></CustodyGuard></AuthGuard></Route>}
        {!isNativeTablet && <Route path="/rooms/:id"><AuthGuard><CustodyGuard><RoomRadarPage /></CustodyGuard></AuthGuard></Route>}
        {isNativeTablet && <Route path="/locations/:id?"><AuthGuard><CustodyGuard><RoomsMasterDetail /></CustodyGuard></AuthGuard></Route>}
        {!isNativeTablet && <Route path="/locations"><AuthGuard><CustodyGuard><RoomsListPage /></CustodyGuard></AuthGuard></Route>}
        {!isNativeTablet && <Route path="/locations/:id"><AuthGuard><CustodyGuard><RoomRadarPage /></CustodyGuard></AuthGuard></Route>}
        <Route path="/print"><AuthGuard><WebOnlyGuard><QrPrintPage /></WebOnlyGuard></AuthGuard></Route>

        {/* --- Emergency & safety --- */}
        {/* Code Blue is intentionally NOT CustodyGuard-wrapped (owner decision):
            students keep emergency-awareness VISIBILITY of an active Code Blue even
            though custody is their action scope — they are already server-403'd on
            every CB mutation, so this is view-only. (/alerts + /rooms still redirect.) */}
        <Route path="/code-blue"><AuthGuard><CodeBluePage /></AuthGuard></Route>
        <Route path="/code-blue/display"><AuthGuard><WebOnlyGuard><CodeBlueDisplay /></WebOnlyGuard></AuthGuard></Route>
        <Route path="/crash-cart"><AuthGuard><CrashCartCheckPage /></AuthGuard></Route>
        <Route path="/handoff"><AuthGuard><HandoffPage /></AuthGuard></Route>
        <Route path="/admin/code-blue-history"><AuthGuard><CodeBlueHistoryPage /></AuthGuard></Route>
        {/* Legacy aliases — intentional identical-component mounts, not
            distinct surfaces (confirmed 2026-07-11 QA audit finding: "/emergency-equipment-wall
            renders the identical idle screen as /code-blue/display — alias or
            unbuilt distinct wall?"). CANONICAL_HREFS + ROUTE_ALIAS_GROUPS
            (src/lib/routes/canonical-hrefs.ts, route-alias-groups.ts) already
            treat these as one nav destination each; new links generate the
            canonical href. The legacy path is kept as a live route (not a
            redirect) deliberately, matching its siblings above, so an
            existing bookmark or a physical display already pointed at the
            legacy URL (e.g. a wall-mounted browser on /code-blue/display)
            never gets an extra navigation hop or a URL change underneath it. */}
        <Route path="/emergency-equipment-log"><AuthGuard><CodeBluePage /></AuthGuard></Route>
        <Route path="/emergency-equipment-wall"><AuthGuard><WebOnlyGuard><CodeBlueDisplay /></WebOnlyGuard></AuthGuard></Route>
        <Route path="/critical-kit-check"><AuthGuard><CrashCartCheckPage /></AuthGuard></Route>
        <Route path="/emergency-equipment-history"><AuthGuard><CodeBlueHistoryPage /></AuthGuard></Route>

        {/* --- Admin --- */}
        <Route path="/admin"><AuthGuard><AdminPage /></AuthGuard></Route>
        <Route path="/admin/shifts"><AuthGuard><AdminShiftsPage /></AuthGuard></Route>
        <Route path="/admin/asset-types"><AuthGuard><AdminAssetTypesPage /></AuthGuard></Route>
        <Route path="/admin/docks"><AuthGuard><AdminDocksPage /></AuthGuard></Route>
        <Route path="/admin/metrics"><AuthGuard><OperationalMetricsDashboardPage /></AuthGuard></Route>
        {/* Web management console (Phase 6) — desktop-only, capability-gated (management.web) */}
        <Route path="/admin/integrations"><AuthGuard><WebOnlyGuard><ManagementGuard><IntegrationsConsolePage /></ManagementGuard></WebOnlyGuard></AuthGuard></Route>
        <Route path="/admin/webhooks"><AuthGuard><WebOnlyGuard><ManagementGuard><WebhooksConsolePage /></ManagementGuard></WebOnlyGuard></AuthGuard></Route>
        <Route path="/admin/notifications"><AuthGuard><WebOnlyGuard><ManagementGuard><NotificationsConsolePage /></ManagementGuard></WebOnlyGuard></AuthGuard></Route>
        <Route path="/admin/rfid-readers"><AuthGuard><WebOnlyGuard><ManagementGuard><RfidReadersConsolePage /></ManagementGuard></WebOnlyGuard></AuthGuard></Route>
        <Route path="/admin/governance"><AuthGuard><WebOnlyGuard><ManagementGuard><GovernanceConsolePage /></ManagementGuard></WebOnlyGuard></AuthGuard></Route>
        <Route path="/admin/audit-log"><AuthGuard><WebOnlyGuard><ManagementGuard><AuditConsolePage /></ManagementGuard></WebOnlyGuard></AuthGuard></Route>
        <Route path="/admin/inventory"><AuthGuard><WebOnlyGuard><ManagementGuard><InventoryConsolePage /></ManagementGuard></WebOnlyGuard></AuthGuard></Route>
        <Route path="/ops/health"><AuthGuard><WebOnlyGuard><ManagementGuard><OpsHealthConsolePage /></ManagementGuard></WebOnlyGuard></AuthGuard></Route>
        <Route path="/admin/people"><AuthGuard><WebOnlyGuard><ManagementGuard><PeopleRolesConsolePage /></ManagementGuard></WebOnlyGuard></AuthGuard></Route>
        <Route path="/admin/displays"><AuthGuard><WebOnlyGuard><ManagementGuard><DisplaysConsolePage /></ManagementGuard></WebOnlyGuard></AuthGuard></Route>
        <Route path="/settings"><AuthGuard><SettingsPage /></AuthGuard></Route>
        <Route path="/help"><AuthGuard><HelpPage /></AuthGuard></Route>
        <Route path="/audit-log"><AuthGuard><WebOnlyGuard><AuditLogPage /></WebOnlyGuard></AuthGuard></Route>
        {/* Legacy admin aliases */}
        <Route path="/admin/medication-integrity"><Redirect to="/admin" replace /></Route>

        {/* --- Platform & analytics --- */}
        <Route path="/inventory"><AuthGuard><InventoryPage /></AuthGuard></Route>
        {/* Stage 5 inventory-items + detail are responsive — reachable on native (iPad/iPhone). */}
        {isNativeTablet && <Route path="/inventory-items/:id?"><AuthGuard><InventoryItemsMasterDetail /></AuthGuard></Route>}
        {!isNativeTablet && <Route path="/inventory-items/:id"><AuthGuard><InventoryItemDetailPage /></AuthGuard></Route>}
        {!isNativeTablet && <Route path="/inventory-items"><AuthGuard><InventoryItemsPage /></AuthGuard></Route>}
        {/* T22: previously ungated (rendered to any authenticated role — a leak).
            Both are management-console-adjacent surfaces (procurement write actions
            are already admin-only in-page; /analytics is listed under management.web
            in WEB_MANAGEMENT_NAV but the route itself never enforced it). Gated with
            the same ManagementGuard as the rest of the console for one consistent
            denial pattern. */}
        <Route path="/procurement"><AuthGuard><WebOnlyGuard><ManagementGuard><ProcurementPage /></ManagementGuard></WebOnlyGuard></AuthGuard></Route>
        <Route path="/analytics/outcome-kpi"><Redirect to="/analytics" replace /></Route>
        <Route path="/analytics/shift-leaderboard"><AuthGuard><WebOnlyGuard><ShiftLeaderboardPage /></WebOnlyGuard></AuthGuard></Route>
        <Route path="/analytics"><AuthGuard><WebOnlyGuard><ManagementGuard><AnalyticsPage /></ManagementGuard></WebOnlyGuard></AuthGuard></Route>
        <Route path="/dashboard"><AuthGuard><WebOnlyGuard><ManagementGuard><ManagementDashboardPage /></ManagementGuard></WebOnlyGuard></AuthGuard></Route>
        <Route path="/whats-new"><AuthGuard><WhatsNewPage /></AuthGuard></Route>
        <Route path="/shift-chat/:shiftId"><AuthGuard><ShiftChatArchive /></AuthGuard></Route>
        {/* Legacy aliases for removed pages → home (no broken nav) */}
        <Route path="/stability"><Redirect to="/home" replace /></Route>
        <Route path="/app-tour"><Redirect to="/home" replace /></Route>
        {/* Legacy platform aliases */}
        <Route path="/meds"><Redirect to="/equipment/tasks" replace /></Route>
        <Route path="/pharmacy-forecast"><Redirect to="/equipment/tasks" replace /></Route>
        <Route path="/patients"><Redirect to="/equipment" replace /></Route>
        <Route path="/patients/:id"><Redirect to="/equipment" replace /></Route>
        <Route path="/pending"><Redirect to="/equipment" replace /></Route>
        <Route path="/billing"><Redirect to="/equipment" replace /></Route>
        <Route path="/billing/:rest*"><Redirect to="/equipment" replace /></Route>
        <Route path="/er"><Redirect to="/equipment" replace /></Route>
        <Route path="/er/:rest*"><Redirect to="/equipment" replace /></Route>
        <Route path="/shift-handover"><Redirect to="/equipment" replace /></Route>
        <Route path="/pending-emergencies"><Redirect to="/equipment" replace /></Route>

        <Route component={NotFoundPage} />
      </Switch>
    </PageErrorBoundary>
  );
}
