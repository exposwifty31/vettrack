import { type ReactNode } from "react";

type Props = {
  children: ReactNode;
};

/**
 * Per-screen wrapper for native pages.
 *
 * Provides a semantic boundary that identifies a native screen without
 * adding competing chrome. NativeShell already owns the scroll container
 * and safe-area insets; NativeScreen is intentionally lightweight.
 *
 * Future: will accept `title` and `toolbarActions` to drive the native
 * header once a NativeHeader component is introduced.
 */
export function NativeScreen({ children }: Props) {
  return <>{children}</>;
}
