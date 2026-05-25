import { safeStorageGetItem, safeStorageRemoveItem, safeStorageSetItem } from "@/lib/safe-browser";

export interface OfflineSessionSnapshot {
  userId: string;
  email: string;
  name: string;
  role: string;
  status: string;
  token: string;
  tokenExp: number;
  lastActiveAt: number;
  clinicId?: string;
}

const SESSION_KEY = "vt_session";
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function extractTokenExp(token: string): number {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return 0;
    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4 !== 0) b64 += "=";
    const payload = JSON.parse(atob(b64));
    if (typeof payload.exp === "number") return payload.exp * 1000;
    return 0;
  } catch {
    return 0;
  }
}

export function saveOfflineSession(data: {
  userId: string;
  email: string;
  name: string;
  role: string;
  status: string;
  token: string;
  tokenExp?: number;
  clinicId?: string;
}): void {
  try {
    const tokenExp = data.tokenExp ?? extractTokenExp(data.token);
    const clinicId =
      typeof data.clinicId === "string" && data.clinicId.trim() !== ""
        ? data.clinicId.trim()
        : undefined;
    const snapshot: OfflineSessionSnapshot = {
      userId: data.userId,
      email: data.email,
      name: data.name,
      role: data.role,
      status: data.status,
      token: data.token,
      tokenExp,
      lastActiveAt: Date.now(),
      ...(clinicId ? { clinicId } : {}),
    };
    safeStorageSetItem(SESSION_KEY, JSON.stringify(snapshot));
  } catch {
  }
}

export function restoreOfflineSession(): OfflineSessionSnapshot | null {
  try {
    const raw = safeStorageGetItem(SESSION_KEY);
    if (!raw) return null;

    const snapshot = JSON.parse(raw) as Partial<OfflineSessionSnapshot>;

    if (typeof snapshot.userId !== "string" || snapshot.userId.trim() === "") return null;
    if (typeof snapshot.email !== "string" || snapshot.email.trim() === "") return null;
    if (typeof snapshot.role !== "string" || snapshot.role.trim() === "") return null;
    if (typeof snapshot.status !== "string" || snapshot.status.trim() === "") return null;
    if (typeof snapshot.token !== "string" || snapshot.token.trim() === "") return null;

    if (!Number.isFinite(snapshot.tokenExp) || (snapshot.tokenExp as number) <= 0) return null;
    if (!Number.isFinite(snapshot.lastActiveAt) || (snapshot.lastActiveAt as number) <= 0) return null;

    if (Date.now() >= (snapshot.tokenExp as number)) return null;
    if (Date.now() - (snapshot.lastActiveAt as number) >= SESSION_MAX_AGE_MS) return null;
    if (snapshot.status !== "active") return null;

    return snapshot as OfflineSessionSnapshot;
  } catch {
    return null;
  }
}

export function clearOfflineSession(): void {
  try {
    safeStorageRemoveItem(SESSION_KEY);
  } catch {
  }
}
