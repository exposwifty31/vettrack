import { createContext, useContext } from "react";

export const MobileShellContext = createContext(false);
export const useMobileShellContext = () => useContext(MobileShellContext);
