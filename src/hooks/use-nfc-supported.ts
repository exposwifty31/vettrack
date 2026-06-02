import { useEffect, useState } from "react";
import { isCapacitorNative } from "@/lib/capacitor-runtime";
import { isNfcSupported, isNfcSupportedSync, primeNfcSupportCache } from "@/lib/nfc-platform";

/** Resolves whether NFC read/write is available (Web NFC or Capacitor native). */
export function useNfcSupported(): { supported: boolean; loading: boolean } {
  const [supported, setSupported] = useState(() => isNfcSupportedSync());
  const [loading, setLoading] = useState(() => isCapacitorNative() && !isNfcSupportedSync());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (isCapacitorNative()) await primeNfcSupportCache();
      const ok = await isNfcSupported();
      if (!cancelled) {
        setSupported(ok);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { supported, loading };
}
