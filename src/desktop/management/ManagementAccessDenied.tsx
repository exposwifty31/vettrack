import { Shield } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

/**
 * The ONE explicit "not authorized for this surface" state (T22 — audit MEDIUM).
 *
 * Before this, a non-admin/vet hitting a management surface saw one of three
 * divergent outcomes depending on which page they landed on: a silent redirect
 * (`ManagementGuard`, /dashboard, /admin/*), an ad-hoc hand-rolled denial screen
 * with page-specific copy (admin.tsx, audit-log.tsx), a bare line of text
 * (shift-leaderboard.tsx), a wrong-key copy bug (admin-shifts.tsx — rendered
 * "Cancel"), or a blank screen (`return null` in AdminAssetTypesPage,
 * AdminDocksPage, OperationalMetricsDashboardPage). Every one of those call
 * sites now renders THIS component instead. Callers own the surrounding chrome
 * (typically `<AppShell>`) and the eligibility check itself — this component is
 * presentation only, so each surface can keep its genuinely-intended floor
 * (`management.web` for the console vs. a stricter literal `admin` where the
 * server itself is `requireAdmin`-only) while looking identical to the user.
 */
export function ManagementAccessDenied() {
  const [, navigate] = useLocation();
  return (
    <div
      className="flex flex-col items-center justify-center gap-4 py-20 text-center"
      data-testid="management-access-denied"
    >
      <Shield className="w-12 h-12 text-muted-foreground" aria-hidden />
      <h1 className="text-2xl font-bold">{t.console.accessDenied.title}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">{t.console.accessDenied.description}</p>
      <Button variant="ghost" onClick={() => navigate("/home")}>
        {t.console.accessDenied.cta}
      </Button>
    </div>
  );
}
