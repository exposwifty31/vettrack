import type { ReactNode } from "react";
import { useExperience } from "@/hooks/use-experience";

interface WriteGateProps {
  children: ReactNode;
  /** Rendered for read-only users (lead). Defaults to nothing. */
  fallback?: ReactNode;
}

/**
 * Renders write affordances only for `management.webWrite` holders (admin /
 * secondary-admin). Lead — read-only — gets `fallback`. UX gating only; the server
 * is the enforcement boundary, so this never authorizes a mutation on its own.
 */
export function WriteGate({ children, fallback = null }: WriteGateProps) {
  const experience = useExperience();
  return <>{experience.can("management.webWrite") ? children : fallback}</>;
}
