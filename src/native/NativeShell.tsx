import { useState, type ReactNode } from "react";
import { NativeShellContext } from "./NativeShellContext";
import { NativeTabBar } from "./NativeTabBar";
import { NativeTabSidebar } from "./NativeTabSidebar";
import { NativeHeader } from "./NativeHeader";
import { MoreSheet } from "@/features/settings";
import { NfcForegroundScan } from "@/components/nfc-foreground-scan";
import { useIsTabletViewport } from "@/lib/use-tablet-viewport";

type Props = {
  children: ReactNode;
};

/**
 * Sole chrome owner for the Capacitor native platform.
 *
 * Owns: safe-area insets · scroll container · tab bar · more sheet.
 *
 * Safe-area strategy:
 *   - Top: NativeHeader owns env(safe-area-inset-top) as part of its own
 *     height (calc(44px + SAT)). The outer shell has NO top padding so that
 *     fullscreen routes (code-blue, crash-cart, scan) can draw edge-to-edge
 *     behind the status bar. Each fullscreen page adds its own paddingTop
 *     to protect interactive content.
 *   - Bottom: NativeTabBar adds paddingBottom via env(safe-area-inset-bottom).
 */
export function NativeShell({ children }: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  const isTablet = useIsTabletViewport();

  if (isTablet) {
    return (
      <NativeShellContext.Provider value={true}>
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            flexDirection: "row",
            overflow: "hidden",
            background: "hsl(var(--background))",
            paddingTop: "env(safe-area-inset-top)",
          }}
        >
          <NativeTabSidebar onMorePress={() => setMoreOpen(true)} />

          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* Tablet header carries settings / avatar / alerts (sidebar owns the wordmark). */}
            <NativeHeader showWordmark={false} ownSafeArea={false} />

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
          </div>

          {!moreOpen && <NfcForegroundScan />}

          <MoreSheet
            open={moreOpen}
            onClose={() => setMoreOpen(false)}
          />
        </div>
      </NativeShellContext.Provider>
    );
  }

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
          // NO paddingTop here — NativeHeader owns the top safe area.
        }}
      >
        <NativeHeader />

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
