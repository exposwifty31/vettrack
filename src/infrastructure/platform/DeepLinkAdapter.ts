import type { IDeepLinkProvider } from "@/core/ports";
import { isCapacitorNative } from "@/lib/capacitor-runtime";

/**
 * Deep-link adapter — wraps @capacitor/app appUrlOpen events.
 * No-ops in the browser; on native it proxies to the Capacitor App plugin.
 */
class DeepLinkAdapter implements IDeepLinkProvider {
  onOpen(handler: (url: string) => void): () => void {
    if (!isCapacitorNative()) return () => {};

    let disposed = false;
    let handle: { remove: () => Promise<void> } | null = null;

    void import("@capacitor/app")
      .then(({ App }) => {
        if (disposed) return;
        return App.addListener("appUrlOpen", ({ url }) => {
          if (!disposed) handler(url);
        }).then((h) => {
          if (disposed) {
            void h.remove();
          } else {
            handle = h;
          }
        });
      })
      .catch((err: unknown) => {
        console.error("[DeepLinkAdapter] Failed to register appUrlOpen listener", err);
      });

    return () => {
      disposed = true;
      void handle?.remove();
    };
  }
}

export const deepLink: IDeepLinkProvider = new DeepLinkAdapter();
