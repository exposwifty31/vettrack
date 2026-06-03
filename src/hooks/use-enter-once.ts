import { useEffect, useState } from "react";

/**
 * Returns true once per session for a given screen key — supports
 * "enter once, then rest" (no re-animation on tab return).
 */
export function useEnterOnce(screenKey: string): boolean {
  const storageKey = `vt-enter-once:${screenKey}`;
  const [shouldEnter] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      if (sessionStorage.getItem(storageKey) === "1") return false;
      sessionStorage.setItem(storageKey, "1");
      return true;
    } catch {
      return true;
    }
  });

  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return shouldEnter && !reduced;
}
