import { useState, type ReactNode } from "react";
import { useLocation } from "wouter";
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
/** Signed-out surfaces own their whole viewport — no header, tab bar, or sidebar. */
const AUTH_ROUTE_PATTERN = /^\/(signin|signup)(\/|$)/;

export function NativeShell({ children }: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  const isTablet = useIsTabletViewport();
  const [location] = useLocation();

  // Auth routes render bare: app chrome around a sign-in form is dead UI for a
  // signed-out user (every tab bounces back through AuthGuard → /signin).
  if (AUTH_ROUTE_PATTERN.test(location)) {
    return (
      <NativeShellContext.Provider value={true}>
        <div
          style={{
            position: "fixed",
            inset: 0,
            overflowY: "auto",
            overflowX: "hidden",
            WebkitOverflowScrolling: "touch",
            overscrollBehaviorY: "contain",
            background: "hsl(var(--background))",
            paddingTop: "env(safe-area-inset-top)",
            paddingBottom: "env(safe-area-inset-bottom)",
            paddingLeft: "env(safe-area-inset-left)",
            paddingRight: "env(safe-area-inset-right)",
          }}
        >
          {children}
        </div>
      </NativeShellContext.Provider>
    );
  }

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
          <NativeTabSidebar />

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

          <NfcForegroundScan />
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
        {/* No centered wordmark on phone: the header now carries the chat launcher
            (matching iPad), and a centered wordmark collides with the icon group on
            the narrow phone canvas. */}
        <NativeHeader showWordmark={false} />

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            overflowX: "hidden",
            WebkitOverflowScrolling: "touch",
            overscrollBehaviorY: "contain",
            // Landscape: page content (search field, filter chips) must clear
            // the camera-housing edge (H4). Portrait resolves both to 0.
            paddingLeft: "env(safe-area-inset-left)",
            paddingRight: "env(safe-area-inset-right)",
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
