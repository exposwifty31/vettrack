import { useState, useEffect, useCallback } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { t } from "@/lib/i18n";
import {
  getServiceWorkerReadySafe,
  getServiceWorkerRegistrationSafe,
  isServiceWorkerSupported,
  registerServiceWorkerSafe,
  safeStorageGetItem,
  safeStorageRemoveItem,
  safeStorageSetItem,
} from "@/lib/safe-browser";

interface PushState {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  subscribed: boolean;
  loading: boolean;
  error: string | null;
}

function getPushSupportBlocker(): string | null {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent.toLowerCase() : "";
  if (ua.includes("cursor")) {
    return t.pushErrors.cursorUnsupported;
  }
  return null;
}

async function requestNotificationPermissionWithTimeout(timeoutMs = 8000): Promise<NotificationPermission> {
  if (!("Notification" in window) || typeof Notification.requestPermission !== "function") {
    return "denied";
  }

  if (Notification.permission === "granted" || Notification.permission === "denied") {
    return Notification.permission;
  }

  return Promise.race<NotificationPermission>([
    Notification.requestPermission(),
    new Promise<NotificationPermission>((resolve) => {
      window.setTimeout(() => resolve("denied"), timeoutMs);
    }),
  ]);
}

function waitForActivation(
  worker: ServiceWorker | null | undefined,
  timeoutMs: number
): Promise<void> {
  if (!worker) return Promise.resolve();
  if (worker.state === "activated") return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(t.pushErrors.serviceWorkerTimeout)), timeoutMs);
    const onStateChange = () => {
      if (worker.state === "activated") {
        window.clearTimeout(timer);
        worker.removeEventListener("statechange", onStateChange);
        resolve();
      }
    };
    worker.addEventListener("statechange", onStateChange);
  });
}

async function waitForServiceWorkerReady(timeoutMs = 8000): Promise<ServiceWorkerRegistration> {
  if (!isServiceWorkerSupported()) {
    throw new Error(t.pushErrors.serviceWorkerUnsupported);
  }

  // Always (re)register the build-versioned worker so an existing install on an
  // old script URL is updated too — `existing ??` would skip cache-busting for
  // everyone but fresh installs. Fall back to any existing registration if the
  // register call itself fails.
  const registration =
    (await registerServiceWorkerSafe(`/sw.js?v=${encodeURIComponent(__VT_BUILD_TAG__)}`)) ??
    (await getServiceWorkerRegistrationSafe());
  if (!registration) {
    throw new Error(t.pushErrors.serviceWorkerUnavailable);
  }

  if (registration.active) {
    return registration;
  }

  await waitForActivation(registration.installing ?? registration.waiting, timeoutMs);
  return registration;
}

async function getVapidPublicKey(): Promise<string> {
  // Prefer the server's runtime key — it is the public half of the pair the server signs with.
  // Only fall back to a build-time key when the server has none configured, so a stale
  // VITE_VAPID_PUBLIC_KEY baked into the bundle can't produce subscriptions the server can't push to.
  try {
    const res = await authFetch("/api/push/vapid-public-key");
    if (res.ok) {
      const { publicKey } = await res.json();
      if (publicKey) return publicKey;
    }
  } catch {
    // fall through to a build-time key
  }
  const envVapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  if (envVapidKey && envVapidKey.trim()) {
    return envVapidKey.trim();
  }
  throw new Error(t.pushErrors.vapidFetchFailed);
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    output[i] = rawData.charCodeAt(i);
  }
  return output as Uint8Array<ArrayBuffer>;
}

export function usePushNotifications() {
  const [state, setState] = useState<PushState>({
    supported: false,
    permission: "default",
    subscribed: false,
    loading: false,
    error: null,
  });

  useEffect(() => {
    const supported =
      isServiceWorkerSupported() &&
      "PushManager" in window &&
      "Notification" in window;

    if (!supported) {
      setState((s) => ({ ...s, supported: false, permission: "unsupported" }));
      return;
    }

    setState((s) => ({
      ...s,
      supported: true,
      permission: Notification.permission,
    }));

    getServiceWorkerReadySafe()
      .then((registration) => {
        if (!registration) {
          setState((s) => ({ ...s, subscribed: false }));
          return;
        }
        registration.pushManager.getSubscription().then((sub) => {
          const storedEndpoint = safeStorageGetItem("push_subscription_endpoint");

          if (storedEndpoint && (!sub || sub.endpoint !== storedEndpoint)) {
            safeStorageRemoveItem("push_subscription_endpoint");
            setState((s) => ({ ...s, subscribed: false }));
          } else {
            setState((s) => ({ ...s, subscribed: !!sub }));
          }
        }).catch(() => {
          setState((s) => ({ ...s, subscribed: false }));
        });
      })
      .catch(() => {
        setState((s) => ({ ...s, subscribed: false }));
      });
  }, []);

  const subscribe = useCallback(async (
    opts?: {
      soundEnabled?: boolean;
      alertsEnabled?: boolean;
      technicianReturnRemindersEnabled?: boolean;
      seniorOwnReturnRemindersEnabled?: boolean;
      seniorTeamOverdueAlertsEnabled?: boolean;
      adminHourlySummaryEnabled?: boolean;
    }
  ): Promise<boolean> => {
    setState((s) => ({ ...s, loading: true, error: null }));

    try {
      const blocker = getPushSupportBlocker();
      if (blocker) {
        setState((s) => ({ ...s, loading: false, error: blocker }));
        return false;
      }

      if (!isServiceWorkerSupported() || !("PushManager" in window)) {
        throw new Error(t.pushErrors.notSupported);
      }

      const permission = await requestNotificationPermissionWithTimeout();
      setState((s) => ({ ...s, permission }));

      if (permission !== "granted") {
        setState((s) => ({ ...s, loading: false, error: t.pushErrors.permissionDenied }));
        return false;
      }

      const vapidKey = await getVapidPublicKey();
      const registration = await waitForServiceWorkerReady();

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      const subJson = subscription.toJSON();
      const res = await authFetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: subJson.endpoint,
          keys: {
            p256dh: subJson.keys?.p256dh,
            auth: subJson.keys?.auth,
          },
          soundEnabled: opts?.soundEnabled !== false,
          alertsEnabled: opts?.alertsEnabled !== false,
          technicianReturnRemindersEnabled: opts?.technicianReturnRemindersEnabled !== false,
          seniorOwnReturnRemindersEnabled: opts?.seniorOwnReturnRemindersEnabled !== false,
          seniorTeamOverdueAlertsEnabled: opts?.seniorTeamOverdueAlertsEnabled !== false,
          adminHourlySummaryEnabled: opts?.adminHourlySummaryEnabled !== false,
        }),
      });

      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(errData.message || t.pushErrors.saveFailed);
      }

      safeStorageSetItem("push_subscription_endpoint", subJson.endpoint || "");
      setState((s) => ({ ...s, subscribed: true, loading: false }));
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : t.pushErrors.subscribeFailed;
      setState((s) => ({ ...s, loading: false, error: msg, subscribed: false }));
      return false;
    }
  }, []);

  const unsubscribe = useCallback(async (): Promise<boolean> => {
    setState((s) => ({ ...s, loading: true, error: null }));

    try {
      if (!isServiceWorkerSupported()) {
        setState((s) => ({ ...s, loading: false, subscribed: false }));
        return false;
      }

      const registration = await getServiceWorkerReadySafe();
      if (!registration) {
        setState((s) => ({ ...s, loading: false, subscribed: false }));
        return false;
      }
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        await authFetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }

      safeStorageRemoveItem("push_subscription_endpoint");
      setState((s) => ({ ...s, subscribed: false, loading: false }));
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to unsubscribe";
      setState((s) => ({ ...s, loading: false, error: msg }));
      return false;
    }
  }, []);

  const updateSettings = useCallback(async (
    opts: {
      soundEnabled?: boolean;
      alertsEnabled?: boolean;
      technicianReturnRemindersEnabled?: boolean;
      seniorOwnReturnRemindersEnabled?: boolean;
      seniorTeamOverdueAlertsEnabled?: boolean;
      adminHourlySummaryEnabled?: boolean;
    }
  ): Promise<boolean> => {
    try {
      if (!isServiceWorkerSupported()) return false;
      const registration = await getServiceWorkerReadySafe();
      if (!registration) return false;
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) return false;

      const res = await authFetch("/api/push/subscribe", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint, ...opts }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  const sendTestNotification = useCallback(async (): Promise<boolean> => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await authFetch("/api/push/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; success?: boolean };
      if (!res.ok) {
        const msg =
          data.message ||
          (res.status === 503
            ? "Push not configured on server"
            : res.status === 409
              ? "No subscription on server — re-enable device notifications in Settings"
              : `Test failed (${res.status})`);
        throw new Error(msg);
      }
      setState((s) => ({ ...s, loading: false }));
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to send test";
      setState((s) => ({ ...s, loading: false, error: msg }));
      return false;
    }
  }, []);

  return {
    ...state,
    subscribe,
    unsubscribe,
    updateSettings,
    sendTestNotification,
  };
}
