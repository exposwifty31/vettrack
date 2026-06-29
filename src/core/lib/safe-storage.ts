type SafeStorageKind = "local" | "session";

function getStorage(kind: SafeStorageKind): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function safeStorageGetItem(key: string, kind: SafeStorageKind = "local"): string | null {
  try {
    return getStorage(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function safeStorageSetItem(key: string, value: string, kind: SafeStorageKind = "local"): boolean {
  try {
    getStorage(kind)?.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
