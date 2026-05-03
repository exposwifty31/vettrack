import { Redirect, Route, Switch } from "wouter";
import { lazy } from "react";
import { AuthGuard } from "@/features/auth/components/AuthGuard";
import { ErModeGuard } from "@/guards/ErModeGuard";
import { PageErrorBoundary } from "@/components/ui/page-error-boundary";
import { useAuth } from "@/hooks/use-auth";
import { shouldShowPostSignupLanding } from "@/lib/post-signup-landing";
import  PendingPage  from "@/pages/pending";

const HomePage = lazy(() => import("@/pages/home"));
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
const ShiftHandoverPage = lazy(() => import("@/pages/shift-handover-page"));
const InventoryPage = lazy(() => import("@/pages/inventory-page"));
const AnalyticsPage = lazy(() => import("@/pages/analytics"));
const OutcomeKpiDashboardPage = lazy(() => import("@/pages/outcome-kpi-dashboard"));
const ManagementDashboardPage = lazy(() => import("@/pages/management-dashboard"));
const QrPrintPage = lazy(() => import("@/pages/qr-print"));
const EquipmentQrPrintPage = lazy(() => import("@/pages/equipment-qr-print"));
const AdminPage = lazy(() => import("@/pages/admin"));
const StabilityDashboardPage = lazy(() => import("@/pages/stability-dashboard"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const HelpPage = lazy(() => import("@/pages/help"));
const AuditLogPage = lazy(() => import("@/pages/audit-log"));
const AdminShiftsPage = lazy(() => import("@/pages/admin-shifts"));
const AdminMedicationIntegrityPage = lazy(() => import("@/pages/admin-medication-integrity"));
const AdminOpsDashboardPage = lazy(() => import("@/pages/admin-ops-dashboard"));
const AppointmentsPage = lazy(() => import("@/pages/appointments"));
const MedicationHubPage = lazy(() => import("@/pages/meds"));
const PharmacyForecastPage = lazy(() => import("@/pages/pharmacy-forecast"));
const CodeBluePage = lazy(() => import("@/pages/code-blue"));
const CodeBlueDisplay = lazy(() => import("@/pages/code-blue-display"));
const CrashCartCheckPage = lazy(() => import("@/pages/crash-cart"));
const CodeBlueHistoryPage = lazy(() => import("@/pages/code-blue-history"));
const AppTourPage = lazy(() => import("@/pages/app-tour"));
const WhatsNewPage = lazy(() => import("@/pages/whats-new"));
const NotFoundPage = lazy(() => import("@/pages/not-found"));
const BillingLedgerPage = lazy(() => import("@/pages/billing-ledger"));
const LeakageReportPage = lazy(() => import("@/pages/leakage-report"));
const InventoryJobsPage = lazy(() => import("@/pages/inventory-jobs"));
const PatientsPage = lazy(() => import("@/pages/patients"));
const PatientDetailPage = lazy(() => import("@/pages/patient-detail"));
const InventoryItemsPage = lazy(() => import("@/pages/inventory-items"));
const ProcurementPage = lazy(() => import("@/pages/procurement"));
const PendingEmergenciesPage = lazy(() => import("@/pages/pending-emergencies"));
const WardDisplayPage = lazy(() => import("@/pages/display"));
const CodeBlueReconciliationPage = lazy(() => import("@/pages/code-blue-reconciliation"));
const ShiftLeaderboardPage = lazy(() => import("@/pages/shift-leaderboard"));
const ShiftChatArchive = lazy(() =>
  import("@/features/shift-chat/components/ShiftChatArchive").then((m) => ({ default: m.ShiftChatArchive }))
);
const ErCommandCenterPage = lazy(() => import("@/pages/er-command-center"));
const ErImpactPage = lazy(() => import("@/pages/er-impact"));
const ErImpactKpisPage = lazy(() => import("@/pages/er-impact-kpis"));

/** `/` — marketing shell for guests; returning signed-in users go to `/home`; new signups see landing once (session flag). */
function RootRoute() {
  const { isLoaded, isSignedIn, isOfflineSession } = useAuth();

  if (!isLoaded && !isOfflineSession) {
    return null;
  }

  if (isSignedIn && !shouldShowPostSignupLanding()) {
    return <Redirect to="/home" />;
  }

  return <LandingPage />;
}

export function AppRoutes() {
  return (
    <PageErrorBoundary fallbackLabel="Page rendering failed">
      <ErModeGuard>
      <Switch>
        <Route path="/" component={RootRoute} />
        <Route path="/landing" component={LandingPage} />
        {/* `/*?` so Clerk path-routed sign-in/up substeps (e.g. /signin/factor-one) still match */}
        <Route path="/signin/*?" component={SignInPage} />
        <Route path="/signup/*?" component={SignUpPage} />

        <Route path="/home"><AuthGuard><HomePage /></AuthGuard></Route>
        <Route path="/equipment"><AuthGuard><EquipmentPage /></AuthGuard></Route>
        <Route path="/equipment/new"><AuthGuard><NewEquipmentPage /></AuthGuard></Route>
        <Route path="/equipment/:id/edit"><AuthGuard><NewEquipmentPage /></AuthGuard></Route>
        <Route path="/equipment/:id/qr"><AuthGuard><EquipmentQrPrintPage /></AuthGuard></Route>
        <Route path="/equipment/:id"><AuthGuard><EquipmentDetailPage /></AuthGuard></Route>
        <Route path="/alerts"><AuthGuard><AlertsPage /></AuthGuard></Route>
        <Route path="/my-equipment"><AuthGuard><MyEquipmentPage /></AuthGuard></Route>
        <Route path="/rooms"><AuthGuard><RoomsListPage /></AuthGuard></Route>
        <Route path="/rooms/:id"><AuthGuard><RoomRadarPage /></AuthGuard></Route>
        <Route path="/shift-handover"><AuthGuard><ShiftHandoverPage /></AuthGuard></Route>
        <Route path="/inventory"><AuthGuard><InventoryPage /></AuthGuard></Route>
        <Route path="/analytics"><AuthGuard><AnalyticsPage /></AuthGuard></Route>
        <Route path="/analytics/outcome-kpi"><AuthGuard><OutcomeKpiDashboardPage /></AuthGuard></Route>
        <Route path="/dashboard"><AuthGuard><ManagementDashboardPage /></AuthGuard></Route>
        <Route path="/print"><AuthGuard><QrPrintPage /></AuthGuard></Route>
        <Route path="/admin"><AuthGuard><AdminPage /></AuthGuard></Route>
        <Route path="/admin/shifts"><AuthGuard><AdminShiftsPage /></AuthGuard></Route>
        <Route path="/admin/medication-integrity"><AuthGuard><AdminMedicationIntegrityPage /></AuthGuard></Route>
        <Route path="/admin/ops-dashboard"><AuthGuard><AdminOpsDashboardPage /></AuthGuard></Route>
        <Route path="/appointments"><AuthGuard><AppointmentsPage /></AuthGuard></Route>
        <Route path="/meds"><AuthGuard><MedicationHubPage /></AuthGuard></Route>
        <Route path="/pharmacy-forecast"><AuthGuard><PharmacyForecastPage /></AuthGuard></Route>
        <Route path="/code-blue"><AuthGuard><CodeBluePage /></AuthGuard></Route>
        <Route path="/display"><AuthGuard><WardDisplayPage /></AuthGuard></Route>
        <Route path="/code-blue/display"><AuthGuard><CodeBlueDisplay /></AuthGuard></Route>
        <Route path="/crash-cart"><AuthGuard><CrashCartCheckPage /></AuthGuard></Route>
        <Route path="/admin/code-blue-history"><AuthGuard><CodeBlueHistoryPage /></AuthGuard></Route>
        <Route path="/app-tour"><AuthGuard><AppTourPage /></AuthGuard></Route>
        <Route path="/stability"><AuthGuard><StabilityDashboardPage /></AuthGuard></Route>
        <Route path="/settings"><AuthGuard><SettingsPage /></AuthGuard></Route>
        <Route path="/help"><AuthGuard><HelpPage /></AuthGuard></Route>
        <Route path="/audit-log"><AuthGuard><AuditLogPage /></AuthGuard></Route>
        <Route path="/whats-new"><AuthGuard><WhatsNewPage /></AuthGuard></Route>
        <Route path="/billing/leakage"><AuthGuard><LeakageReportPage /></AuthGuard></Route>
        <Route path="/billing/inventory-jobs"><AuthGuard><InventoryJobsPage /></AuthGuard></Route>
        <Route path="/billing/code-blue-reconciliation"><AuthGuard><CodeBlueReconciliationPage /></AuthGuard></Route>
        <Route path="/billing"><AuthGuard><BillingLedgerPage /></AuthGuard></Route>
        <Route path="/analytics/shift-leaderboard"><AuthGuard><ShiftLeaderboardPage /></AuthGuard></Route>
        <Route path="/patients"><AuthGuard><PatientsPage /></AuthGuard></Route>
        <Route path="/pending">
  <AuthGuard>
    <PendingPage />
  </AuthGuard>
</Route>
        <Route path="/patients/:id"><AuthGuard><PatientDetailPage /></AuthGuard></Route>
        <Route path="/inventory-items"><AuthGuard><InventoryItemsPage /></AuthGuard></Route>
        <Route path="/procurement"><AuthGuard><ProcurementPage /></AuthGuard></Route>
        <Route path="/pending-emergencies"><AuthGuard><PendingEmergenciesPage /></AuthGuard></Route>
        <Route path="/shift-chat/:shiftId"><AuthGuard><ShiftChatArchive /></AuthGuard></Route>
        <Route path="/er/impact"><AuthGuard><ErImpactPage /></AuthGuard></Route>
        <Route path="/er/kpis"><AuthGuard><ErImpactKpisPage /></AuthGuard></Route>
        <Route path="/er"><AuthGuard><ErCommandCenterPage /></AuthGuard></Route>
        <Route component={NotFoundPage} />
      </Switch>
      </ErModeGuard>
    </PageErrorBoundary>
  );
}
