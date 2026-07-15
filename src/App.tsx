import { Suspense, useEffect } from "react";
import { AppRoutes } from "@/app/routes";
import { useAutoSelectOrg } from "@/features/auth/hooks/useAutoSelectOrg";
import { useAuth } from "@/hooks/use-auth";
import { startLeaderHeartbeat } from "@/lib/leader";
import { PageErrorBoundary } from "@/components/ui/page-error-boundary";
import { PwaInstallPrompt } from "@/components/pwa-install-prompt";
import { EquipmentRealtimeBridge } from "@/components/equipment/EquipmentRealtimeBridge";
import { RouteFallback } from "@/components/route-fallback";
import { PlatformRouter } from "@/app/platform/PlatformRouter";
import { isClerkEnabled } from "@/lib/auth-fetch";
import { t } from "@/lib/i18n";

const CLERK_ENABLED = isClerkEnabled();

function AutoSelectOrg() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded || !isSignedIn) return null;
  return <AutoSelectOrgWhenSignedIn />;
}

function AutoSelectOrgWhenSignedIn() {
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
          <PlatformRouter>
            <AppRoutes />
          </PlatformRouter>
        </PageErrorBoundary>
      </Suspense>
      <PwaInstallPrompt />
    </>
  );
}
