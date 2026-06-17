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
