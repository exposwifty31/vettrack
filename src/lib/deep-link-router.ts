import { App, type URLOpenListenerEvent } from "@capacitor/app";
import type { PluginListenerHandle } from "@capacitor/core";
import { navigate } from "wouter/use-browser-location";
import { extractEquipmentId, UNIVERSAL_LINK_HOST } from "@/lib/equipment-id";
import { isCapacitorNative } from "@/lib/capacitor-runtime";
import { toast } from "sonner";
import { t } from "@/lib/i18n";

const OAUTH_CALLBACK_HOST = "oauth-callback";
const SCAN_HOST = "scan";
const DEDUPE_WINDOW_MS = 1500;

let initialized = false;
let lastHandledUrl: string | null = null;
let lastHandledAt = 0;
let appUrlOpenHandle: PluginListenerHandle | null = null;

function isDuplicate(url: string): boolean {
  const now = Date.now();
  if (url === lastHandledUrl && now - lastHandledAt < DEDUPE_WINDOW_MS) return true;
  lastHandledUrl = url;
  lastHandledAt = now;
  return false;
}

export async function teardownDeepLinkRouterForTests(): Promise<void> {
  await appUrlOpenHandle?.remove();
  appUrlOpenHandle = null;
  initialized = false;
  lastHandledUrl = null;
  lastHandledAt = 0;
}

export function __resetDeepLinkRouterStateForTests(): void {
  void appUrlOpenHandle?.remove();
  appUrlOpenHandle = null;
  initialized = false;
  lastHandledUrl = null;
  lastHandledAt = 0;
}

export const __test = {
  handleDeepLink,
  __resetDeepLinkRouterStateForTests,
};

function handleDeepLink(rawUrl: string): void {
  if (!rawUrl) return;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    console.warn(`[deep-link-router] unparseable URL ignored: ${rawUrl}`);
    return;
  }
  const isVettrackScheme = parsed.protocol === "vettrack:";
  const host = isVettrackScheme ? (parsed.host || parsed.pathname.replace(/^\/+/, "")) : "";
  if (isVettrackScheme && host === OAUTH_CALLBACK_HOST) {
    // INTENTIONAL NO-OP. native-oauth.ts owns this callback via its own
    // promise-scoped appUrlOpen listener and consumes the rotating_token_nonce.
    // Acting here would double-consume the nonce and break sign-in.
    // NOTE (nit): returned BEFORE isDuplicate() so an oauth-callback never writes the
    // dedupe state — otherwise it could swallow a legitimate distinct deep link inside
    // the 1500ms window. (Callbacks carry a rotating nonce so they are non-identical anyway.)
    return;
  }
  if (isDuplicate(rawUrl)) return;
  if (isVettrackScheme) {
    if (host === SCAN_HOST) {
      navigate("/equipment?scan=1");
      return;
    }
    console.warn(`[deep-link-router] unknown vettrack:// host: ${host}`);
    return;
  }
  if (parsed.protocol === "https:" && parsed.hostname === UNIVERSAL_LINK_HOST) {
    const equipmentId = extractEquipmentId(rawUrl);
    if (equipmentId) {
      toast.loading(t.nfcEntry.openingEquipment, { id: "nfc-open" });
      navigate(`/equipment/${equipmentId}?nfcAction=toggle&nfcTs=${Date.now()}`);
      return;
    }
    console.warn(`[deep-link-router] https link without equipment id: ${rawUrl}`);
    return;
  }
  console.warn(`[deep-link-router] unhandled URL ignored: ${rawUrl}`);
}

export function initDeepLinkRouter(): void {
  if (initialized || !isCapacitorNative()) return;
  initialized = true;
  // HOT/WARM launch: app already running → Capacitor appUrlOpen.
  void App.addListener("appUrlOpen", (event: URLOpenListenerEvent) => {
    handleDeepLink(event.url);
  }).then((handle) => {
    appUrlOpenHandle = handle;
  });
  // COLD launch: process started BY the link; no appUrlOpen for the first URL.
  void App.getLaunchUrl().then((result) => {
    if (result?.url) handleDeepLink(result.url);
  });
}
