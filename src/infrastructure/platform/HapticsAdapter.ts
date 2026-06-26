import type { IHapticsProvider } from "@/core/ports";

/**
 * Capacitor Haptics adapter.
 * Silently no-ops in the browser or when the plugin is unavailable
 * — haptics are enhancement-only and must never block a user flow.
 */
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
    } catch {
      // Not available in browser or simulator — safe to ignore.
    }
  }

  async selectionChanged(): Promise<void> {
    try {
      const { Haptics } = await import("@capacitor/haptics");
      await Haptics.selectionChanged();
    } catch {
      // Not available in browser or simulator — safe to ignore.
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
    } catch {
      // Not available in browser or simulator — safe to ignore.
    }
  }
}

export const haptics: IHapticsProvider = new HapticsAdapter();
