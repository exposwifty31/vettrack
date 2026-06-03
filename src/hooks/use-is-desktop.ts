import { useEffect, useState } from "react";

const DESKTOP_MQ = "(min-width: 1024px)";

/** True when viewport is lg+ (1024px). Updates on resize. */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(DESKTOP_MQ).matches;
  });

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_MQ);
    const onChange = () => setIsDesktop(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return isDesktop;
}
