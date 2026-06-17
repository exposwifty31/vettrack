import { isValidJwt } from "@/lib/auth-fetch";

/** Persisted by `createNativeClerkInstance` — must not be sent to VetTrack `/api`. */
export const CLERK_CLIENT_JWT_STORAGE_KEY = "__vt_clerk_client_jwt";

const NATIVE_SESSION_TOKEN_RETRY_DELAYS_MS = [0, 200, 500, 1_000, 2_000, 3_000] as const;

type ClerkGlobal = {
  session?: { getToken: (opts?: { skipCache?: boolean }) => Promise<string | null> };
};

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    return JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function isClerkClientJwt(token: string): boolean {
  if (!token) return false;
  try {
    const stored = window.localStorage.getItem(CLERK_CLIENT_JWT_STORAGE_KEY) ?? "";
    return Boolean(stored && token === stored);
  } catch {
    return false;
  }
}

/** Session JWTs carry a Clerk session id (`sid`); client JWTs do not. */
export function isClerkSessionJwt(token: string): boolean {
  if (!isValidJwt(token) || isClerkClientJwt(token)) return false;
  const payload = decodeJwtPayload(token);
  return typeof payload?.sid === "string" && payload.sid.length > 0;
}

/** Ask clerk-js to mint a fresh session JWT (native transport has no cookie jar). */
export async function warmNativeClerkSessionToken(): Promise<void> {
  const clerk = (globalThis as { Clerk?: ClerkGlobal }).Clerk;
  if (!clerk?.session?.getToken) return;
  await clerk.session.getToken({ skipCache: true });
}

async function readNativeSessionToken(
  getToken?: (opts?: { skipCache?: boolean }) => Promise<string | null | undefined>,
): Promise<string | null> {
  const clerk = (globalThis as { Clerk?: ClerkGlobal }).Clerk;
  if (clerk?.session?.getToken) {
    const fromSession = await clerk.session.getToken({ skipCache: true });
    const sessionToken = typeof fromSession === "string" ? fromSession.trim() : "";
    if (isClerkSessionJwt(sessionToken)) return sessionToken;
  }

  if (getToken) {
    const raw = await getToken({ skipCache: true });
    const hookToken = typeof raw === "string" ? raw.trim() : "";
    if (isClerkSessionJwt(hookToken)) return hookToken;
  }

  return null;
}

/**
 * Resolve a backend-ready Clerk session JWT on Capacitor.
 * `getToken()` can briefly return the client JWT right after sign-in; retry until
 * a session JWT (`sid` claim) is available.
 */
export async function resolveNativeClerkSessionToken(
  getToken: (opts?: { skipCache?: boolean }) => Promise<string | null | undefined>,
): Promise<string> {
  for (const delayMs of NATIVE_SESSION_TOKEN_RETRY_DELAYS_MS) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    await warmNativeClerkSessionToken();
    const token = await readNativeSessionToken(getToken);
    if (token) {
      return token;
    }
  }

  const raw = await getToken({ skipCache: true });
  const fallback = typeof raw === "string" ? raw.trim() : "";
  if (!fallback || !isValidJwt(fallback) || isClerkClientJwt(fallback)) {
    return "";
  }
  // Last resort: trust Clerk's getToken() for the API when sid detection fails (e.g. payload decode).
  return fallback;
}

export function summarizeClerkToken(token: string): Record<string, unknown> {
  if (!token) return { empty: true };
  const payload = decodeJwtPayload(token);
  const sub = typeof payload?.sub === "string" ? payload.sub : null;
  return {
    tokenLen: token.length,
    hasSid: typeof payload?.sid === "string",
    sts: payload?.sts ?? null,
    azp: typeof payload?.azp === "string" ? payload.azp : null,
    issHost: typeof payload?.iss === "string" ? payload.iss.replace(/^https?:\/\//, "").split("/")[0] : null,
    subPrefix: sub ? sub.slice(0, 8) : null,
    isClientJwt: isClerkClientJwt(token),
    isSessionJwt: isClerkSessionJwt(token),
  };
}
