import { useState } from "react";
import { X, Download, Share2, PlusSquare } from "lucide-react";
import { useLocation } from "wouter";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import { t } from "@/lib/i18n";

const EMERGENCY_ROUTES = ["/code-blue", "/crash-cart"];

// Shows for eligible users who haven't installed the app:
//   • Android / Chrome  → native "Add to Home Screen" prompt
//   • iOS Safari        → step-by-step guidance (re-shown every 7 days)
// Hidden when already running as an installed PWA.
export function PwaInstallPrompt() {
  const [location] = useLocation();
  const { isStandalone, isIos, canInstall, promptInstall, iosGuidanceDismissed, dismissIosGuidance } =
    usePwaInstall();

  // Session-level dismiss for the Android/Chrome banner (native prompt handles persistence).
  const [androidDismissed, setAndroidDismissed] = useState(false);

  // Never interrupt emergency flows with promotional UI.
  if (EMERGENCY_ROUTES.some((r) => location.startsWith(r))) return null;

  // Already installed — show nothing.
  if (isStandalone) return null;

  // ── Android / Chrome install banner ──────────────────────────────────────
  if (canInstall && !androidDismissed) {
    return (
      <div
        role="complementary"
        aria-label="Install VetTrack"
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
          <div className="flex-1 min-w-0" dir="ltr">
            <p className="font-semibold text-sm text-foreground leading-snug">
              Install VetTrack
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
              Add to your home screen for faster access — works offline too.
            </p>
            <div className="flex gap-2 mt-3">
              <button
                onClick={async () => {
                  await promptInstall();
                  setAndroidDismissed(true);
                }}
                className="inline-flex items-center justify-center gap-1.5 px-4 min-h-[44px] rounded-lg bg-primary text-primary-foreground text-sm font-semibold"
              >
                <Download className="w-4 h-4" />
                Install
              </button>
              <button
                onClick={() => setAndroidDismissed(true)}
                className="inline-flex items-center justify-center gap-1.5 px-4 min-h-[44px] rounded-lg bg-secondary text-secondary-foreground text-sm font-medium"
              >
                Not now
              </button>
            </div>
          </div>
          <button
            onClick={() => setAndroidDismissed(true)}
            aria-label={t.common.close}
            className="flex items-center justify-center min-w-[44px] min-h-[44px] -mt-2 -me-2 text-muted-foreground hover:text-foreground shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
    );
  }

  // ── iOS Safari guidance ──────────────────────────────────────────────────
  // Re-shown every 7 days so staff who dismiss it early can still find it.
  if (isIos && !iosGuidanceDismissed) {
    return (
      <div
        role="complementary"
        aria-label="Add VetTrack to Home Screen"
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
            <div className="flex-1 min-w-0" dir="ltr">
              <p className="font-semibold text-sm text-foreground leading-tight">
                Install VetTrack
              </p>
              <p className="text-xs text-muted-foreground leading-snug">
                Works offline · Full-screen · No App Store needed
              </p>
            </div>
            <button
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
      </div>
    );
  }

  return null;
}
