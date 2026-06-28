import { type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

/**
 * Chrome-free passthrough shell for public/unauthenticated routes.
 * Owns no navigation, no sidebar, no safe-area — the page itself is the full surface.
 */
export function MarketingShell({ children }: Props) {
  return <>{children}</>;
}
