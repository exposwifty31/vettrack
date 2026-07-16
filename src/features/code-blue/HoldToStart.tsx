import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";
import { haptics } from "@/lib/haptics";
import { generateHoldToken } from "./hold-token";

/**
 * R-CBF-1.3 — the safe "one tap": arm→hold-to-confirm.
 *
 * A literal one-tap Code Blue is an accidental-emergency generator (phone in a
 * scrub pocket) and fights Apple's deliberate-confirmation rule. Resolution
 * (Emergency-SOS precedent): tap = ARM (the full-screen armed screen) → COMMIT =
 * an exactly-800ms press-and-hold with an escalating haptic ramp
 * (`warning()`→`locked()`) and a filling ring, always-visible Cancel. Reads as
 * one gesture, instant under stress, pocket-proof.
 *
 * The completed hold generates the per-gesture idempotency token (R-CBF-1.1) and
 * calls `onCommit(token)`; the token is stable across retries of the same
 * gesture. Emergency-flow guardrail: every affordance is keyboard/switch
 * operable — no pointer-only or hover-only path.
 *
 * `disabled` marks the control display-only: iPad and board render
 * server-confirmed sessions and CANNOT arm, hold, or start locally.
 */
const HOLD_MS = 800;
/** ≥56px emergency touch-target floor (with headroom). */
const TOUCH_TARGET_PX = 64;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export interface HoldToStartProps {
  /** Fired once when the 800ms hold completes, with the per-gesture token. */
  onCommit: (token: string) => void;
  /** Cancel / Escape — dismisses the armed screen without starting. */
  onCancel: () => void;
  /** In-flight commit: the hold is inert while the server call is pending. */
  busy?: boolean;
  /** Display-only (iPad / board): cannot arm, hold, or start locally. */
  disabled?: boolean;
  /** Focus returns here on cancel/close (accidental entry must never trap). */
  triggerRef?: React.RefObject<HTMLElement | null>;
  /** Optional test id applied to the hold button (launch-form probe). */
  testId?: string;
}

export function HoldToStart({
  onCommit,
  onCancel,
  busy = false,
  disabled = false,
  triggerRef,
  testId,
}: HoldToStartProps) {
  const holdRef = useRef<HTMLButtonElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenRef = useRef<string | null>(null);
  const [holding, setHolding] = useState(false);
  const reduced = usePrefersReducedMotion();
  const hintId = useId();

  const inert = disabled || busy;

  // Focus enters the armed control on open — screen-reader / switch users land
  // on the commit affordance, not adrift on the page.
  useEffect(() => {
    if (!disabled) holdRef.current?.focus();
  }, [disabled]);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const cancelHold = useCallback(() => {
    clearTimer();
    setHolding(false);
  }, [clearTimer]);

  const completeHold = useCallback(() => {
    clearTimer();
    setHolding(false);
    haptics.locked();
    const token = tokenRef.current ?? generateHoldToken();
    tokenRef.current = token;
    onCommit(token);
  }, [clearTimer, onCommit]);

  const startHold = useCallback(() => {
    if (inert || holding || timerRef.current !== null) return;
    if (tokenRef.current === null) tokenRef.current = generateHoldToken();
    setHolding(true);
    haptics.warning();
    timerRef.current = setTimeout(completeHold, HOLD_MS);
  }, [inert, holding, completeHold]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const handleCancel = useCallback(() => {
    cancelHold();
    onCancel();
    triggerRef?.current?.focus();
  }, [cancelHold, onCancel, triggerRef]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      handleCancel();
      return;
    }
    if ((e.key === " " || e.key === "Enter") && !e.repeat) {
      e.preventDefault();
      startHold();
    }
  };

  const onKeyUp = (e: React.KeyboardEvent) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      cancelHold();
    }
  };

  const targetStyle = { minWidth: TOUCH_TARGET_PX, minHeight: TOUCH_TARGET_PX };

  return (
    <div
      className="flex flex-col items-center gap-4"
      dir="ltr"
      data-testid="cb-armed-control"
    >
      <button
        ref={holdRef}
        type="button"
        disabled={inert}
        data-testid={testId}
        aria-label={t.codeBlue.hold.instruction}
        aria-describedby={hintId}
        onPointerDown={startHold}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onPointerCancel={cancelHold}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        style={{ ...targetStyle, touchAction: "none" }}
        className={cn(
          "relative flex flex-col items-center justify-center gap-2 rounded-full p-8",
          "bg-emergency-accent text-white font-bold select-none",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
          "disabled:opacity-50 disabled:pointer-events-none",
          holding && "scale-[0.98]",
        )}
      >
        <span
          data-testid="cb-hold-ring"
          data-reduced-motion={reduced ? "true" : "false"}
          data-holding={holding ? "true" : "false"}
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 rounded-full border-4 border-white/40",
            holding && "border-white",
            !reduced && "transition-[border-color,opacity] motion-safe:duration-[800ms] motion-safe:ease-linear",
          )}
          style={reduced ? undefined : { transitionDuration: holding ? `${HOLD_MS}ms` : "0ms" }}
        />
        <AlertTriangle className="h-8 w-8" aria-hidden />
        <span className="text-base [writing-mode:horizontal-tb]">{t.codeBlue.hold.instruction}</span>
      </button>

      <p id={hintId} className="text-xs text-emergency-text2 text-center [writing-mode:horizontal-tb]">
        {t.codeBlue.hold.hint}
      </p>

      <button
        type="button"
        onClick={handleCancel}
        aria-label={t.codeBlue.hold.cancel}
        style={targetStyle}
        className="rounded-full border border-emergency-border bg-emergency-border/80 px-6 text-sm font-medium text-emergency-text hover:bg-emergency-border [writing-mode:horizontal-tb]"
      >
        {t.codeBlue.hold.cancel}
      </button>
    </div>
  );
}
