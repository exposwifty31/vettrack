import { useState, type ReactNode } from "react";
import { MobileShellContext } from "./MobileShellContext";
import { MobileTabBar } from "./MobileTabBar";
import { MoreSheet } from "@/features/settings";

type Props = {
  children: ReactNode;
};

export function MobileShell({ children }: Props) {
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <MobileShellContext.Provider value={true}>
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
        <MobileTabBar onMorePress={() => setMoreOpen(true)} />
        <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
      </div>
    </MobileShellContext.Provider>
  );
}
