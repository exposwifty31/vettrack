import { Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { t } from "@/lib/i18n";

/**
 * T-31 (R-WEB-01) — capability gate for the desktop web shell.
 *
 * `PlatformRouter`'s `desktop` branch (src/app/platform/PlatformRouter.tsx) is a
 * bare passthrough — mobile and board each get a dedicated shell, but desktop had
 * none, so ANY authenticated role reaching a desktop browser got the full desktop
 * chrome, including roles that should never see it (vet_tech, student). Mounted
 * INSIDE `AuthGuard` (after auth resolves — never before it, or the loading/
 * signed-out states AuthGuard itself owns would misfire against this check) when
 * `target === "desktop" && !experience.can("management.web")`.
 *
 * The action is **sign out**, matching AuthGuard's sibling denial states
 * (pending / blocked / accessDenied). It deliberately does NOT offer an in-app
 * navigation CTA: this check lives inside `AuthGuard`, which wraps essentially
 * every route, so there is no reachable destination that escapes the same gate —
 * a "go to X" button would loop straight back to this screen. The path forward is
 * to open VetTrack on a device (per the description) or switch accounts via sign-out.
 */
export function ManagementWebGate() {
  const { signOut } = useAuth();
  return (
    <div
      className="dark fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-background px-8 text-center text-foreground"
      data-testid="management-web-gate-screen"
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-muted/40 text-muted-foreground">
        <Monitor className="h-8 w-8" aria-hidden />
      </div>
      <div className="flex flex-col gap-2">
        <h1 className="text-lg font-bold text-foreground">{t.managementWebGate.title}</h1>
        <p className="mx-auto max-w-xs text-sm leading-relaxed text-muted-foreground">
          {t.managementWebGate.description}
        </p>
      </div>
      <Button
        size="lg"
        className="w-full max-w-xs"
        onClick={signOut}
        data-testid="management-web-gate-cta"
      >
        {t.auth.guard.signOut}
      </Button>
    </div>
  );
}
