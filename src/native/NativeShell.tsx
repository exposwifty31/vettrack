import { useState, type ReactNode } from "react";
import { NativeShellContext } from "./NativeShellContext";
import { NativeTabBar } from "./NativeTabBar";
import { MoreSheet } from "@/features/settings";

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
          display: "flex",
          flexDirection: "column",
          height: "100%",
          paddingTop: "env(safe-area-inset-top)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            flex: 1,
            overflow: "hidden auto",
            overscrollBehavior: "contain",
          }}
        >
          {children}
        </div>
        <NativeTabBar onMorePress={() => setMoreOpen(true)} />
        <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
      </div>
    </NativeShellContext.Provider>
  );
}
