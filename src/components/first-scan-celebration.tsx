import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";

interface FirstScanCelebrationProps {
  open: boolean;
  onContinue: () => void;
}

/** Brief earned moment after the first equipment scan of the shift day — not persistent home chrome. */
export function FirstScanCelebration({ open, onContinue }: FirstScanCelebrationProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-black/75 p-4 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="first-scan-celebration-title"
      data-testid="first-scan-celebration"
    >
      <div className="w-full max-w-sm rounded-3xl border border-ivory-border bg-ivory-surface p-6 text-center shadow-2xl motion-safe:animate-in motion-safe:slide-in-from-bottom-8 motion-safe:duration-300">
        <div
          className="mx-auto mb-4 flex h-[88px] w-[88px] items-center justify-center rounded-full border-2 border-emerald-500/40 bg-emerald-500/10"
          aria-hidden
        >
          <svg viewBox="0 0 88 88" className="h-[88px] w-[88px] -rotate-90">
            <circle cx="44" cy="44" r="36" fill="none" stroke="currentColor" strokeWidth="6" className="text-muted/30" />
            <circle
              cx="44"
              cy="44"
              r="36"
              fill="none"
              stroke="currentColor"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray="226"
              strokeDashoffset="56"
              className="text-emerald-600 motion-safe:animate-[stroke-draw_900ms_ease-out_forwards]"
            />
          </svg>
          <CheckCircle2 className="absolute h-9 w-9 text-emerald-600" />
        </div>
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">{t.scanCelebration.kicker}</p>
        <h2 id="first-scan-celebration-title" className="mt-2 text-xl font-bold tracking-tight text-ivory-text">
          {t.scanCelebration.title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ivory-text3">{t.scanCelebration.body}</p>
        <Button
          type="button"
          className="mt-5 h-14 w-full rounded-2xl text-base font-bold"
          onClick={onContinue}
          data-testid="btn-first-scan-continue"
        >
          {t.scanCelebration.continue}
        </Button>
      </div>
    </div>
  );
}
