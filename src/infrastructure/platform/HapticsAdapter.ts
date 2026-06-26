import type { IHapticsProvider } from "@/core/ports";

/**
 * Capacitor Haptics adapter.
 * Silently no-ops when the plugin is not available (browser, simulator, or plugin not installed).
 * Unexpected errors are re-thrown so callers can observe real failures.
 */

function isPluginUnavailable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("not implemented") ||
    msg.includes("not available") ||
    msg.includes("plugin") ||
    msg.includes("unimplemented")
  );
}

class HapticsAdapter implements IHapticsProvider {
  async impact(style: "light" | "medium" | "heavy"): Promise<void> {
    try {
      const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
      const styleMap = {
        light: ImpactStyle.Light,
        medium: ImpactStyle.Medium,
        heavy: ImpactStyle.Heavy,
      };
      await Haptics.impact({ style: styleMap[style] });
    } catch (err) {
      if (!isPluginUnavailable(err)) throw err;
    }
  }

  async selectionChanged(): Promise<void> {
    try {
      const { Haptics } = await import("@capacitor/haptics");
      await Haptics.selectionChanged();
    } catch (err) {
      if (!isPluginUnavailable(err)) throw err;
    }
  }

  async notification(type: "success" | "warning" | "error"): Promise<void> {
    try {
      const { Haptics, NotificationType } = await import("@capacitor/haptics");
      const typeMap = {
        success: NotificationType.Success,
        warning: NotificationType.Warning,
        error: NotificationType.Error,
      };
      await Haptics.notification({ type: typeMap[type] });
    } catch (err) {
      if (!isPluginUnavailable(err)) throw err;
    }
  }
}

export const haptics: IHapticsProvider = new HapticsAdapter();
