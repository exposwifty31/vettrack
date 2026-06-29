import { useState, type ReactNode } from "react";
import { NativeShellContext } from "./NativeShellContext";
import { NativeTabBar } from "./NativeTabBar";
import { MoreSheet } from "@/features/settings";
import { NfcForegroundScan } from "@/components/nfc-foreground-scan";

type Props = {
  children: ReactNode;
};

/**
 * Sole chrome owner for the Capacitor native platform.
 *
 * Owns: safe-area insets · scroll container · tab bar · more sheet.
 * Nothing else in the tree should re-declare these concerns when
 * NativeShellContext is true.
 */


export function NativeShell({ children }: Props) {
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <NativeShellContext.Provider value={true}>
      <div
        style={{
          position: "fixed",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: "hsl(var(--background))",
          paddingTop: "env(safe-area-inset-top)",
        }}
      >
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            overflowX: "hidden",
            WebkitOverflowScrolling: "touch",
            overscrollBehaviorY: "contain",
          }}
        >
          {children}
        </div>

        {!moreOpen && <NfcForegroundScan />}

        <NativeTabBar
          onMorePress={() => setMoreOpen(true)}
        />

        <MoreSheet
          open={moreOpen}
          onClose={() => setMoreOpen(false)}
        />
      </div>
    </NativeShellContext.Provider>
  );
}
