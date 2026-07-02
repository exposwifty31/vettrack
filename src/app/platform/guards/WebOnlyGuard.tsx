import { Redirect, useLocation } from "wouter";
import { type ReactNode } from "react";
import { Monitor } from "lucide-react";
import { isCapacitorNative } from "@/lib/capacitor-runtime";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

type Props = { children: ReactNode; fallback?: string };

/**
 * Gates web-only, desktop-dense surfaces (Command Center board, analytics,
 * procurement, audit log…). Two layers:
 *   1. Capacitor-native shells never see these routes — redirect to `fallback`.
 *   2. BUG-009: below the 1024px desktop breakpoint (iPhone / iPad browser),
 *      these layouts overflow and mislead. Render a dark guard screen that
 *      routes the operator to the mobile-appropriate view instead of the
 *      broken desktop layout.
 *
 * Place inside AuthGuard so auth is resolved before the platform check.
 */
export function WebOnlyGuard({ children, fallback = "/home" }: Props) {
  const isDesktop = useIsDesktop();
  const [, navigate] = useLocation();

  if (isCapacitorNative()) {
    return <Redirect to={fallback} replace />;
  }

  if (!isDesktop) {
    return (
      <div
        className="dark fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-background px-8 text-center text-foreground"
        data-testid="web-only-guard-screen"
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-muted/40 text-muted-foreground">
          <Monitor className="h-8 w-8" aria-hidden />
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="text-lg font-bold text-foreground">{t.webOnlyGuard.title}</h1>
          <p className="mx-auto max-w-xs text-sm leading-relaxed text-muted-foreground">
            {t.webOnlyGuard.description}
          </p>
        </div>
        <Button
          size="lg"
          className="w-full max-w-xs"
          onClick={() => navigate(fallback)}
          data-testid="web-only-guard-cta"
        >
          {t.webOnlyGuard.cta}
        </Button>
      </div>
    );
  }

  return <>{children}</>;
}
