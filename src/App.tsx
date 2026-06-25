import { Suspense, useEffect } from "react";
import { AppRoutes } from "@/app/routes";
import { useAutoSelectOrg } from "@/features/auth/hooks/useAutoSelectOrg";
import { useAuth } from "@/hooks/use-auth";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { startLeaderHeartbeat } from "@/lib/leader";
import { PageErrorBoundary } from "@/components/ui/page-error-boundary";
import { PwaInstallPrompt } from "@/components/pwa-install-prompt";
import { EquipmentRealtimeBridge } from "@/components/equipment/EquipmentRealtimeBridge";
import { RouteFallback } from "@/components/route-fallback";
import { MobileShell } from "@/shell/mobile";
import { t } from "@/lib/i18n";

const CLERK_ENABLED = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

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
  const isMobile = useIsMobile();

  useEffect(() => {
    startLeaderHeartbeat();
  }, []);

  return (
    <>
      {CLERK_ENABLED && <AutoSelectOrg />}
      <EquipmentRealtimeBridge />
      <Suspense fallback={<RouteFallback />}>
        <PageErrorBoundary fallbackLabel={t.errorCard.defaultMessage}>
          {isMobile ? (
            <MobileShell>
              <AppRoutes />
            </MobileShell>
          ) : (
            <AppRoutes />
          )}
        </PageErrorBoundary>
      </Suspense>
      <PwaInstallPrompt />
    </>
  );
}
