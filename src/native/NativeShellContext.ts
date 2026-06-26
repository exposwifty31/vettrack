import { createContext, useContext } from "react";

/**
 * True when the component tree is mounted inside NativeShell.
 * Consumers use this to skip rendering web chrome (headers, sidebars)
 * because NativeShell owns all chrome for the native platform.
 */
export const NativeShellContext = createContext(false);
export const useNativeShellContext = () => useContext(NativeShellContext);
