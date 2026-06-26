// Shell barrel — platform-specific shells are in src/native/ and src/desktop/.
// This barrel exists for legacy compat; prefer direct imports from those paths.
export { NativeShell, NativeShellContext, useNativeShellContext } from "@/native/index";
export { WebShell } from "@/desktop/index";
