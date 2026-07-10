import { X, Download, Share2, PlusSquare } from "lucide-react";
import { useLocation } from "wouter";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import { isKioskSuppressedPathname } from "@/app/platform";
import { t } from "@/lib/i18n";

// Shows for eligible users who haven't installed the app:
//   • Android / Chrome  → native "Add to Home Screen" prompt
//   • iOS Safari        → step-by-step guidance (re-shown every 7 days)
// Hidden when already running as an installed PWA.
export function PwaInstallPrompt() {
  const [location] = useLocation();
  const {
    isStandalone,
    isIos,
    canInstall,
    promptInstall,
    androidDismissed,
    dismissAndroidBanner,
    iosGuidanceDismissed,
    dismissIosGuidance,
  } = usePwaInstall();

  // Never show the promo on emergency flows or kiosk/display surfaces (a
  // headless board/wall is not a personal device — the banner also overlapped
  // the /board/pair code input, F9, and rendered over /emergency-equipment-wall).
  const path = location.split("?")[0];
  if (isKioskSuppressedPathname(path)) return null;

  // Already installed — show nothing.
  if (isStandalone) return null;

  // ── Android / Chrome install banner ──────────────────────────────────────
  if (canInstall && !androidDismissed) {
    return (
      <aside
        aria-label={t.pwa.installAriaLabel}
        data-testid="pwa-install-banner"
        className="fixed bottom-0 inset-x-0 z-50"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0px)" }}
      >
        <div className="mx-4 mb-4 rounded-2xl border border-border bg-background/95 shadow-xl backdrop-blur-md p-4 flex items-start gap-3">
          <img
            src="/icons/icon-192.png"
            alt=""
            className="w-12 h-12 rounded-xl shrink-0"
          />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm text-foreground leading-snug">
              {t.pwa.installTitle}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
              {t.pwa.installSubtitle}
            </p>
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={async () => {
                  await promptInstall();
                  dismissAndroidBanner();
                }}
                className="inline-flex items-center justify-center gap-1.5 px-4 min-h-[44px] rounded-lg bg-primary text-primary-foreground text-sm font-semibold"
              >
                <Download className="w-4 h-4" />
                {t.pwa.install}
              </button>
              <button
                type="button"
                onClick={() => dismissAndroidBanner()}
                className="inline-flex items-center justify-center gap-1.5 px-4 min-h-[44px] rounded-lg bg-secondary text-secondary-foreground text-sm font-medium"
              >
                {t.pwa.notNow}
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => dismissAndroidBanner()}
            aria-label={t.common.close}
            className="flex items-center justify-center min-w-[44px] min-h-[44px] -mt-2 -me-2 text-muted-foreground hover:text-foreground shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </aside>
    );
  }

  // ── iOS Safari guidance ──────────────────────────────────────────────────
  // Re-shown every 7 days so staff who dismiss it early can still find it.
  if (isIos && !iosGuidanceDismissed) {
    return (
      <aside
        aria-label={t.pwa.iosAriaLabel}
        data-testid="pwa-ios-guidance"
        className="fixed bottom-0 inset-x-0 z-50"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0px)" }}
      >
        <div className="mx-4 mb-4 rounded-2xl border border-border bg-background/95 shadow-2xl backdrop-blur-md p-4">
          {/* Header row */}
          <div className="flex items-center gap-3 mb-3">
            <img
              src="/icons/icon-192.png"
              alt=""
              className="w-10 h-10 rounded-xl shrink-0"
            />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm text-foreground leading-tight">
                {t.pwa.installTitle}
              </p>
              <p className="text-xs text-muted-foreground leading-snug">
                {t.pwa.iosTagline}
              </p>
            </div>
            <button
              type="button"
              onClick={dismissIosGuidance}
              aria-label={t.common.close}
              className="flex items-center justify-center min-w-[44px] min-h-[44px] -mt-2 -me-2 text-muted-foreground hover:text-foreground shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Steps — iOS UI element names are always shown in English on device */}
          <div className="bg-muted/50 rounded-xl px-3 py-2.5 space-y-2" dir="ltr">
            <div className="flex items-center gap-2.5 text-xs text-foreground">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground font-bold shrink-0 text-[10px]">
                1
              </span>
              <span className="flex items-center gap-1.5">
                Tap the
                <Share2 className="w-3.5 h-3.5 text-primary inline" />
                <strong>Share</strong> button in Safari's toolbar
              </span>
            </div>
            <div className="flex items-center gap-2.5 text-xs text-foreground">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground font-bold shrink-0 text-[10px]">
                2
              </span>
              <span className="flex items-center gap-1.5">
                Scroll down and tap
                <PlusSquare className="w-3.5 h-3.5 text-primary inline" />
                <strong>Add to Home Screen</strong>
              </span>
            </div>
          </div>
        </div>
      </aside>
    );
  }

  return null;
}
