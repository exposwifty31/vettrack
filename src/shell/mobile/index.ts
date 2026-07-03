// Backward-compat barrel. Canonical exports live under src/native/.
export { NativeShell as MobileShell } from "@/native/NativeShell";
export {
  NativeShellContext as MobileShellContext,
  useNativeShellContext as useMobileShellContext,
} from "@/native/NativeShellContext";
export { NativeTabBar as MobileTabBar } from "@/native/NativeTabBar";
