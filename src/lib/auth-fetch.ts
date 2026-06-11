import { getCurrentUserId, getStoredBearerToken } from "./auth-store";
import { resolveApiUrl } from "./api-origin";

type ClerkTokenGetter = (() => Promise<string | null>) | null;

let clerkTokenGetter: ClerkTokenGetter = null;

export function setClerkTokenGetter(getter: ClerkTokenGetter): void {
  clerkTokenGetter = getter;
}

export function isValidJwt(token?: string | null): boolean {
  return !!token && token.split(".").length === 3;
}

function isClerkEnabledForFetch(): boolean {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const processEnv =
    typeof process !== "undefined" ? (process as { env?: Record<string, string | undefined> }).env : undefined;
  return Boolean(env?.VITE_CLERK_PUBLISHABLE_KEY || processEnv?.VITE_CLERK_PUBLISHABLE_KEY);
}

async function resolveToken(): Promise<string | null> {
  if (clerkTokenGetter) {
    const token = await clerkTokenGetter();
    return typeof token === "string" ? token.trim() : null;
  }
  const stored = getStoredBearerToken();
  return typeof stored === "string" ? stored.trim() : null;
}

export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const resolvedUrl = resolveApiUrl(url);
  if (!url.startsWith("/api/")) {
    return fetch(resolvedUrl, { ...options, credentials: "include" });
  }

  const userId = getCurrentUserId()?.trim();
  if (!userId) {
    console.warn("Blocked request: missing userId");
    throw new Error("AUTH_INVALID");
  }

  const token = await resolveToken();
  const clerkEnabled = isClerkEnabledForFetch();

  if (clerkEnabled && !isValidJwt(token)) {
    console.warn("Blocked request: invalid token");
    throw new Error("AUTH_INVALID");
  }

  const headers = new Headers(options.headers ?? {});
  if (token && isValidJwt(token)) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(resolvedUrl, {
    ...options,
    headers,
    credentials: "include",
  });

  if (res.status === 401) {
    console.warn("Unauthorized request");
    throw new Error("UNAUTHORIZED");
  }

  return res;
}
