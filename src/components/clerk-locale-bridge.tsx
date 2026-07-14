import { ClerkProvider, type ClerkProp } from "@clerk/clerk-react";
import { useEffect, useState, type ReactNode } from "react";
import {
  clerkLocalizationForLocale,
  type ClerkProviderRuntimeProps,
} from "@/lib/clerk-capacitor-config";
import { getCurrentLocale, type Locale } from "@/lib/i18n";

/**
 * Wraps ClerkProvider so the Clerk sign-in card's locale tracks the app's
 * current locale live, not just at boot (T8 — the card previously always
 * rendered in English regardless of the surrounding Hebrew chrome).
 * Re-derives on the "vettrack:locale-changed" event AppBootstrap already
 * listens to, so a mid-session locale switch updates the card without a full
 * reload. `runtimeProps.localization` (from `clerkProviderPropsForRuntime`) is
 * the boot-time snapshot; this overrides it on every render with the live
 * value.
 *
 * ClerkProvider only reads its `localization` prop reliably at init — later
 * prop updates alone don't reliably re-localize an already-mounted card. The
 * `key={locale}` forces React to unmount + remount ClerkProvider (and its
 * subtree) whenever the locale changes, guaranteeing the new localization
 * actually takes effect.
 */
export function ClerkLocaleBridge({
  runtimeProps,
  nativeClerk,
  children,
}: {
  runtimeProps: ClerkProviderRuntimeProps;
  nativeClerk?: ClerkProp;
  children: ReactNode;
}) {
  const [locale, setLocale] = useState<Locale>(() => getCurrentLocale());
  useEffect(() => {
    const handler = () => setLocale(getCurrentLocale());
    window.addEventListener("vettrack:locale-changed", handler);
    return () => window.removeEventListener("vettrack:locale-changed", handler);
  }, []);
  return (
    <ClerkProvider
      key={locale}
      {...runtimeProps}
      localization={clerkLocalizationForLocale(locale)}
      Clerk={nativeClerk}
    >
      {children}
    </ClerkProvider>
  );
}
