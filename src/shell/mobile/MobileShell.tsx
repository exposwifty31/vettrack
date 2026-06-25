import type { ReactNode } from "react";
import { MobileShellContext } from "./MobileShellContext";
import { MobileTabBar } from "./MobileTabBar";

type Props = {
  children: ReactNode;
};

export function MobileShell({ children }: Props) {
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
        <MobileTabBar />
      </div>
    </MobileShellContext.Provider>
  );
}
