import type { IDeepLinkProvider } from "@/core/ports";
import { isCapacitorNative } from "@/lib/capacitor-runtime";

/**
 * Deep-link adapter — wraps @capacitor/app appUrlOpen events.
 * No-ops in the browser; on native it proxies to the Capacitor App plugin.
 */
class DeepLinkAdapter implements IDeepLinkProvider {
  onOpen(handler: (url: string) => void): () => void {
    if (!isCapacitorNative()) return () => {};

    let handle: { remove: () => Promise<void> } | null = null;

    void import("@capacitor/app").then(({ App }) => {
      void App.addListener("appUrlOpen", ({ url }) => {
        handler(url);
      }).then((h) => {
        handle = h;
      });
    });

    return () => {
      void handle?.remove();
    };
  }
}

export const deepLink: IDeepLinkProvider = new DeepLinkAdapter();
