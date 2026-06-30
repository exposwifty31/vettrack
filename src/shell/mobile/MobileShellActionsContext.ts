import { createContext, useContext } from "react";

type MobileShellActions = {
  openMore: () => void;
};

export const MobileShellActionsContext = createContext<MobileShellActions>({ openMore: () => {} });
export const useMobileShellActions = () => useContext(MobileShellActionsContext);
