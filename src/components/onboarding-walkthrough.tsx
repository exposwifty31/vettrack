import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { QrCode, LogIn, AlertTriangle, ChevronRight, X } from "lucide-react";
import { t } from "@/lib/i18n";
import { safeStorageGetItem, safeStorageSetItem } from "@/lib/safe-browser";

const ONBOARDING_KEY = "vettrack_onboarding_v1";

const STEPS = [
  {
    icon: QrCode,
    iconBg: "bg-primary/10 dark:bg-primary/20",
    iconColor: "text-primary",
    tag: t.onboarding.step1.tag,
    title: t.onboarding.step1.title,
    description: t.onboarding.step1.description,
    tip: t.onboarding.step1.tip,
  },
  {
    icon: LogIn,
    iconBg: "bg-indigo-50 dark:bg-indigo-950/50",
    iconColor: "text-indigo-600 dark:text-indigo-400",
    tag: t.onboarding.step2.tag,
    title: t.onboarding.step2.title,
    description: t.onboarding.step2.description,
    tip: t.onboarding.step2.tip,
  },
  {
    icon: AlertTriangle,
    iconBg: "bg-red-50 dark:bg-red-950/50",
    iconColor: "text-red-600 dark:text-red-400",
    tag: t.onboarding.step3.tag,
    title: t.onboarding.step3.title,
    description: t.onboarding.step3.description,
    tip: t.onboarding.step3.tip,
  },
];

export function OnboardingWalkthrough() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!safeStorageGetItem(ONBOARDING_KEY)) {
      setVisible(true);
    }
  }, []);

  function dismiss() {
    safeStorageSetItem(ONBOARDING_KEY, "1");
    setVisible(false);
  }

  function next() {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      dismiss();
    }
  }

  if (!visible) return null;

  const current = STEPS[step];
  const Icon = current.icon;
  const isLast = step === STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      data-testid="onboarding-overlay"
    >
      <div
        className="w-full max-w-sm bg-card rounded-2xl shadow-2xl border border-border overflow-hidden"
        style={{ animation: "fadeIn 0.2s ease" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Progress dots + close */}
        <div className="flex items-center justify-between px-5 pt-5 pb-0">
          <div
            className="flex gap-1.5"
            role="tablist"
            aria-label="Walkthrough steps"
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") {
                e.preventDefault();
                setStep((s) => Math.min(s + 1, STEPS.length - 1));
              } else if (e.key === "ArrowLeft") {
                e.preventDefault();
                setStep((s) => Math.max(s - 1, 0));
              }
            }}
          >
            {STEPS.map((_, i) => (
              <button
                key={i}
                role="tab"
                aria-selected={i === step}
                onClick={() => setStep(i)}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === step
                    ? "w-6 bg-primary"
                    : i < step
                    ? "w-3 bg-primary/40"
                    : "w-3 bg-muted-foreground/20"
                }`}
                aria-label={`Go to step ${i + 1} of ${STEPS.length}`}
              />
            ))}
          </div>
          <button
            onClick={dismiss}
            className="w-11 h-11 flex items-center justify-center -me-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            aria-label="Skip walkthrough"
            data-testid="btn-onboarding-dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step body */}
        <div className="px-5 pt-4 pb-3">
          <div
            className={`w-14 h-14 rounded-2xl ${current.iconBg} flex items-center justify-center mb-4`}
          >
            <Icon className={`w-7 h-7 ${current.iconColor}`} />
          </div>
          <p className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-1">
            {current.tag}
          </p>
          <h2 className="text-lg font-bold text-foreground leading-snug mb-2">
            {current.title}
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {current.description}
          </p>
        </div>

        {/* Tip callout */}
        <div className="mx-5 mb-4 rounded-xl bg-muted/60 border border-border px-3 py-2.5">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">Tip: </span>
            {current.tip}
          </p>
        </div>

        {/* Actions */}
        <div className="px-5 pb-6 flex items-center justify-between gap-3">
          <button
            onClick={dismiss}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors py-2 min-h-[44px] px-1"
            data-testid="btn-onboarding-skip"
          >
            Skip
          </button>
          <Button
            className="gap-1.5 h-11 px-5"
            onClick={next}
            data-testid="btn-onboarding-next"
          >
            {isLast ? t.onboarding.gotIt : t.onboarding.next}
            {!isLast && <ChevronRight className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
