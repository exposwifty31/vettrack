import { useLocation } from "wouter";
import { Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

type Props = { fallback?: string };

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
 * Reuses the `WebOnlyGuard` denial pattern (dark full-bleed screen, icon, title,
 * description, CTA back to `fallback`) with copy specific to this gate — it is a
 * distinct surface from `WebOnlyGuard` (which gates on screen size, not capability),
 * not a variant of it, so `WebOnlyGuard` itself is left untouched.
 */
export function ManagementWebGate({ fallback = "/home" }: Props) {
  const [, navigate] = useLocation();
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
        onClick={() => navigate(fallback)}
        data-testid="management-web-gate-cta"
      >
        {t.managementWebGate.cta}
      </Button>
    </div>
  );
}
