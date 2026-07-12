import { App } from "@capacitor/app";
import { isCapacitorNative } from "@/lib/capacitor-runtime";
import { authFetch } from "@/lib/auth-fetch";

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function getBundledAppVersion(): string {
  return typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0";
}

/** Canonical build tag (`${version}-${timestamp36}`, e.g. "1.1.2-mrexd45b") — the
 * same value `public/sw.js`'s cache name and the split-version detector key off
 * (see CLAUDE.md "PWA build-tag" frozen surface). Read-only here; never derive
 * a build/version display from a hand-maintained literal. */
export function getBundledBuildTag(): string {
  return typeof __VT_BUILD_TAG__ !== "undefined" ? __VT_BUILD_TAG__ : "unknown";
}

/** Short display suffix of the build tag (strips the leading "{version}-"
 * that `VT_BUILD_TAG` is built from in vite.config.ts), e.g. "mrexd45b". Falls
 * back to the raw tag when it doesn't match that shape (dev/"unknown"). */
export function getBuildTagSuffix(): string {
  const tag = getBundledBuildTag();
  const version = getBundledAppVersion();
  const prefix = `${version}-`;
  return tag.startsWith(prefix) ? tag.slice(prefix.length) : tag;
}

export async function resolveDisplayAppVersion(): Promise<string> {
  if (!isCapacitorNative()) {
    return getBundledAppVersion();
  }
  try {
    const { version } = await App.getInfo();
    return version || getBundledAppVersion();
  } catch {
    return getBundledAppVersion();
  }
}

export async function resolveServerAppVersion(): Promise<string | null> {
  try {
    const response = await authFetch("/api/version");
    if (!response.ok) return null;
    const data = (await response.json()) as { version?: string };
    return typeof data.version === "string" ? data.version : null;
  } catch {
    return null;
  }
}
