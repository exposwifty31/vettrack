import { Suspense, useEffect } from "react";
import { AppRoutes } from "@/app/routes";
import { useAutoSelectOrg } from "@/features/auth/hooks/useAutoSelectOrg";
import { startLeaderHeartbeat } from "@/lib/leader";
import { PageErrorBoundary } from "@/components/ui/page-error-boundary";
import { PwaInstallPrompt } from "@/components/pwa-install-prompt";
import { EquipmentRealtimeBridge } from "@/components/equipment/EquipmentRealtimeBridge";
import { RouteFallback } from "@/components/route-fallback";
import { t } from "@/lib/i18n";

const CLERK_ENABLED = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

function AutoSelectOrg() {
  useAutoSelectOrg();
  return null;
}

export default function App() {
  useEffect(() => {
    startLeaderHeartbeat();
  }, []);

  return (
    <>
      {CLERK_ENABLED && <AutoSelectOrg />}
      <EquipmentRealtimeBridge />
      <Suspense fallback={<RouteFallback />}>
        <PageErrorBoundary fallbackLabel={t.errorCard.defaultMessage}>
          <AppRoutes />
        </PageErrorBoundary>
      </Suspense>
      <PwaInstallPrompt />
    </>
  );
}
