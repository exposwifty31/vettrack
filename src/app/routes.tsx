import { Redirect, Route, Switch, useSearch } from "wouter";
import { lazy } from "react";
import { AuthGuard } from "@/features/auth/components/AuthGuard";
import { AuthBootstrapSpinner } from "@/components/native-clerk-gate";
import { RouteFallback } from "@/components/route-fallback";
import { PageErrorBoundary } from "@/components/ui/page-error-boundary";
import { useAuth } from "@/hooks/use-auth";
import { isCapacitorNative } from "@/lib/capacitor-runtime";
import { shouldShowPostSignupLanding } from "@/lib/post-signup-landing";

const CLERK_ENABLED = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

// --- Always-available pages ---
const HomePage = lazy(() => import("@/pages/home"));
const ShiftRecapPage = lazy(() => import("@/pages/shift-recap"));
const LandingPage = lazy(() => import("@/pages/landing"));
const SignUpPage = lazy(() => import("@/pages/signup"));
const SignInPage = lazy(() => import("@/pages/signin"));
const EquipmentPage = lazy(() => import("@/pages/equipment-list"));
const EquipmentDetailPage = lazy(() => import("@/pages/equipment-detail"));
const NewEquipmentPage = lazy(() => import("@/pages/new-equipment"));
const AlertsPage = lazy(() => import("@/pages/alerts"));
const MyEquipmentPage = lazy(() => import("@/pages/my-equipment"));
const RoomsListPage = lazy(() => import("@/pages/rooms-list"));
const RoomRadarPage = lazy(() => import("@/pages/room-radar"));
const QrPrintPage = lazy(() => import("@/pages/qr-print"));
const EquipmentQrPrintPage = lazy(() => import("@/pages/equipment-qr-print"));
const AdminPage = lazy(() => import("@/pages/admin"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const HelpPage = lazy(() => import("@/pages/help"));
const CodeBluePage = lazy(() => import("@/pages/code-blue"));
const CodeBlueDisplay = lazy(() => import("@/pages/code-blue-display"));
const CrashCartCheckPage = lazy(() => import("@/pages/crash-cart"));
const CodeBlueHistoryPage = lazy(() => import("@/pages/code-blue-history"));
const WardDisplayPage = lazy(() => import("@/pages/display"));
const NotFoundPage = lazy(() => import("@/pages/not-found"));

// --- Platform pages ---
const InventoryPage = lazy(() => import("@/pages/inventory-page"));
const AnalyticsPage = lazy(() => import("@/pages/analytics"));
const OutcomeKpiDashboardPage = lazy(() => import("@/pages/outcome-kpi-dashboard"));
const ManagementDashboardPage = lazy(() => import("@/pages/management-dashboard"));
const AdminShiftsPage = lazy(() => import("@/pages/admin-shifts"));
const AdminOpsDashboardPage = lazy(() => import("@/pages/admin-ops-dashboard"));
const AdminAssetTypesPage = lazy(() => import("@/pages/AdminAssetTypesPage"));
const AdminDocksPage = lazy(() => import("@/pages/AdminDocksPage"));
const OperationalMetricsDashboardPage = lazy(() => import("@/pages/OperationalMetricsDashboardPage"));
const AppointmentsPage = lazy(() => import("@/pages/appointments"));
const StabilityDashboardPage = lazy(() => import("@/pages/stability-dashboard"));
const AuditLogPage = lazy(() => import("@/pages/audit-log"));
const WhatsNewPage = lazy(() => import("@/pages/whats-new"));
const ShiftLeaderboardPage = lazy(() => import("@/pages/shift-leaderboard"));
const InventoryItemsPage = lazy(() => import("@/pages/inventory-items"));
const ProcurementPage = lazy(() => import("@/pages/procurement"));
const ShiftChatArchive = lazy(() =>
  import("@/features/shift-chat/components/ShiftChatArchive").then((m) => ({ default: m.ShiftChatArchive }))
);
const AppTourPage = lazy(() => import("@/pages/app-tour"));

function RedirectPreserveSearch({ to }: { to: string }) {
  const search = useSearch();
  return <Redirect to={`${to}${search}`} replace />;
}

/** `/` — marketing shell for guests; returning signed-in users go to `/home`; new signups see landing once (session flag). */
function RootRoute() {
  const { isLoaded, isSignedIn, isOfflineSession } = useAuth();

  // Bundled Capacitor shell: skip marketing landing — sign-in has Clerk loading/error UI.
  if (isCapacitorNative() && CLERK_ENABLED && !isOfflineSession && !isSignedIn) {
    return <Redirect to="/signin" replace />;
  }

  if (!isLoaded && !isOfflineSession) {
    return isCapacitorNative() ? <AuthBootstrapSpinner /> : <RouteFallback />;
  }

  if (isSignedIn && !shouldShowPostSignupLanding()) {
    return <Redirect to="/home" />;
  }

  return <LandingPage />;
}

export function AppRoutes() {
  return (
    <PageErrorBoundary fallbackLabel="Page rendering failed">
      <Switch>

        {/* --- Auth & landing --- */}
        <Route path="/" component={RootRoute} />
        <Route path="/landing" component={LandingPage} />
        <Route path="/signin/*?" component={SignInPage} />
        <Route path="/signup/*?" component={SignUpPage} />

        {/* --- Today & shifts --- */}
        <Route path="/home"><AuthGuard><HomePage /></AuthGuard></Route>
        <Route path="/recap"><AuthGuard><ShiftRecapPage /></AuthGuard></Route>

        {/* --- Equipment & board (canonical: /equipment, /equipment/tasks, /equipment/board) --- */}
        <Route path="/equipment"><AuthGuard><EquipmentPage /></AuthGuard></Route>
        <Route path="/equipment/new"><AuthGuard><NewEquipmentPage /></AuthGuard></Route>
        <Route path="/equipment/tasks"><AuthGuard><AppointmentsPage /></AuthGuard></Route>
        <Route path="/equipment/board"><AuthGuard><WardDisplayPage /></AuthGuard></Route>
        <Route path="/equipment/:id/edit"><AuthGuard><NewEquipmentPage /></AuthGuard></Route>
        <Route path="/equipment/:id/qr"><AuthGuard><EquipmentQrPrintPage /></AuthGuard></Route>
        <Route path="/equipment/:id"><AuthGuard><EquipmentDetailPage /></AuthGuard></Route>
        {/* Legacy aliases → canonicals */}
        <Route path="/appointments"><Redirect to="/equipment/tasks" replace /></Route>
        <Route path="/equipment-tasks"><Redirect to="/equipment/tasks" replace /></Route>
        <Route path="/display"><RedirectPreserveSearch to="/equipment/board" /></Route>
        <Route path="/equipment-board"><Redirect to="/equipment/board" replace /></Route>
        <Route path="/scan"><Redirect to="/equipment?scan=1" replace /></Route>
        <Route path="/equipment/scan"><Redirect to="/equipment?scan=1" replace /></Route>
        <Route path="/equipment/maintenance"><Redirect to="/equipment?status=maintenance" replace /></Route>
        <Route path="/equipment/intelligence"><Redirect to="/equipment" replace /></Route>
        <Route path="/alerts"><AuthGuard><AlertsPage /></AuthGuard></Route>
        <Route path="/my-equipment"><AuthGuard><MyEquipmentPage /></AuthGuard></Route>
        <Route path="/rooms"><AuthGuard><RoomsListPage /></AuthGuard></Route>
        <Route path="/rooms/:id"><AuthGuard><RoomRadarPage /></AuthGuard></Route>
        <Route path="/locations"><AuthGuard><RoomsListPage /></AuthGuard></Route>
        <Route path="/locations/:id"><AuthGuard><RoomRadarPage /></AuthGuard></Route>
        <Route path="/print"><AuthGuard><QrPrintPage /></AuthGuard></Route>

        {/* --- Emergency & safety --- */}
        <Route path="/code-blue"><AuthGuard><CodeBluePage /></AuthGuard></Route>
        <Route path="/code-blue/display"><AuthGuard><CodeBlueDisplay /></AuthGuard></Route>
        <Route path="/crash-cart"><AuthGuard><CrashCartCheckPage /></AuthGuard></Route>
        <Route path="/admin/code-blue-history"><AuthGuard><CodeBlueHistoryPage /></AuthGuard></Route>
        {/* Legacy aliases */}
        <Route path="/emergency-equipment-log"><AuthGuard><CodeBluePage /></AuthGuard></Route>
        <Route path="/emergency-equipment-wall"><AuthGuard><CodeBlueDisplay /></AuthGuard></Route>
        <Route path="/critical-kit-check"><AuthGuard><CrashCartCheckPage /></AuthGuard></Route>
        <Route path="/emergency-equipment-history"><AuthGuard><CodeBlueHistoryPage /></AuthGuard></Route>

        {/* --- Admin --- */}
        <Route path="/admin"><AuthGuard><AdminPage /></AuthGuard></Route>
        <Route path="/admin/shifts"><AuthGuard><AdminShiftsPage /></AuthGuard></Route>
        <Route path="/admin/ops-dashboard"><AuthGuard><AdminOpsDashboardPage /></AuthGuard></Route>
        <Route path="/admin/asset-types"><AuthGuard><AdminAssetTypesPage /></AuthGuard></Route>
        <Route path="/admin/docks"><AuthGuard><AdminDocksPage /></AuthGuard></Route>
        <Route path="/admin/metrics"><AuthGuard><OperationalMetricsDashboardPage /></AuthGuard></Route>
        <Route path="/settings"><AuthGuard><SettingsPage /></AuthGuard></Route>
        <Route path="/help"><AuthGuard><HelpPage /></AuthGuard></Route>
        <Route path="/stability"><AuthGuard><StabilityDashboardPage /></AuthGuard></Route>
        <Route path="/audit-log"><AuthGuard><AuditLogPage /></AuthGuard></Route>
        {/* Legacy admin aliases */}
        <Route path="/admin/medication-integrity"><Redirect to="/admin" replace /></Route>

        {/* --- Platform & analytics --- */}
        <Route path="/inventory"><AuthGuard><InventoryPage /></AuthGuard></Route>
        <Route path="/inventory-items"><AuthGuard><InventoryItemsPage /></AuthGuard></Route>
        <Route path="/procurement"><AuthGuard><ProcurementPage /></AuthGuard></Route>
        <Route path="/analytics/outcome-kpi"><AuthGuard><OutcomeKpiDashboardPage /></AuthGuard></Route>
        <Route path="/analytics/shift-leaderboard"><AuthGuard><ShiftLeaderboardPage /></AuthGuard></Route>
        <Route path="/analytics"><AuthGuard><AnalyticsPage /></AuthGuard></Route>
        <Route path="/dashboard"><AuthGuard><ManagementDashboardPage /></AuthGuard></Route>
        <Route path="/whats-new"><AuthGuard><WhatsNewPage /></AuthGuard></Route>
        <Route path="/shift-chat/:shiftId"><AuthGuard><ShiftChatArchive /></AuthGuard></Route>
        <Route path="/app-tour"><AuthGuard><AppTourPage /></AuthGuard></Route>
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
