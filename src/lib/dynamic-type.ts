import { registerPlugin, Capacitor } from "@capacitor/core";

/**
 * Native bridge to iOS Dynamic Type (`UIApplication.preferredContentSizeCategory`).
 *
 * The Swift implementation lives at `ios/App/App/DynamicTypePlugin.swift`. It is
 * NOT yet registered in the Xcode App target (project.pbxproj) — until it is and
 * a native build is verified, `getScale()` rejects and this resolves to null on
 * every platform, so the app falls back to the in-app "Text size" setting. Web
 * always returns null.
 */
interface DynamicTypePlugin {
  getScale(): Promise<{ scale: number }>;
}

const DynamicType = registerPlugin<DynamicTypePlugin>("DynamicType");

/**
 * iOS content-size-category scale (~0.82–1.5), or null when unavailable (web, or
 * before the native plugin is registered). Never throws.
 */
export async function getNativeContentSizeScale(): Promise<number | null> {
  if (Capacitor.getPlatform() !== "ios") return null;
  try {
    const { scale } = await DynamicType.getScale();
    return typeof scale === "number" && scale > 0 ? scale : null;
  } catch {
    return null;
  }
}
