import { getCurrentUserId, getStoredBearerToken } from "./auth-store";
import { resolveApiUrl } from "./api-origin";
import {
  getStoredDisplayToken,
  clearStoredDisplayToken,
  markDisplayRevokedNotice,
} from "./display-token-store";

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

/** localStorage key for the dev-only role override (dev-bypass builds only). */
export const DEV_ROLE_OVERRIDE_KEY = "vt:devRole";

/**
 * Roles the dev switcher may impersonate — limited to the values the SERVER
 * actually honors. `normalizeUserRole` (server) collapses the client-only alias
 * roles `lead_technician`/`vet_tech` to `student`, so exercise the "lead"
 * archetype via `senior_technician` and the "tech" archetype via `technician`.
 */
export const DEV_OVERRIDE_ROLES = ["admin", "vet", "senior_technician", "technician", "student"] as const;
export type DevOverrideRole = (typeof DEV_OVERRIDE_ROLES)[number];

export function isDevOverrideRole(value: unknown): value is DevOverrideRole {
  return typeof value === "string" && (DEV_OVERRIDE_ROLES as readonly string[]).includes(value);
}

/** True only in dev-bypass builds (no Clerk key). The dev-role switcher is inert otherwise. */
export function isDevBypassBuild(): boolean {
  return !isClerkEnabledForFetch();
}

/**
 * The active dev-role override, or null. Always null in Clerk builds (the
 * switcher is inert there — the server also gates the header on dev-bypass, so
 * this is a second, client-side guard) and when no valid role is stored. Read on
 * every `/api/` request so switching roles takes effect without app-code changes.
 */
export function getDevRoleOverride(): DevOverrideRole | null {
  if (!isDevBypassBuild()) return null;
  try {
    const raw = globalThis.localStorage?.getItem(DEV_ROLE_OVERRIDE_KEY);
    return isDevOverrideRole(raw) ? raw : null;
  } catch {
    return null;
  }
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

  // Phase 9 — paired display-device path. A headless display has no Clerk user;
  // when a device token is stored AND no user is signed in, authenticate the
  // request with the `x-display-token` header instead of the user bearer. Gated
  // on `!userId` so a normal signed-in session is never routed through here —
  // the user-auth path below stays byte-identical and cannot be affected.
  if (!userId) {
    const displayToken = getStoredDisplayToken();
    if (displayToken) {
      const displayHeaders = new Headers(options.headers ?? {});
      displayHeaders.set("x-display-token", displayToken);
      const displayRes = await fetch(resolvedUrl, { ...options, headers: displayHeaders, credentials: "include" });
      if (displayRes.status === 401) {
        // Revoked/invalid display token — flag a one-shot notice for the
        // pairing screen (T21: a silent revert to a bare form left the kiosk
        // operator with no explanation), then clear it and return to the
        // pairing kiosk rather than the /signin flow a headless display can't
        // complete.
        markDisplayRevokedNotice();
        clearStoredDisplayToken();
        if (typeof window !== "undefined") window.location.href = "/board/pair";
      }
      return displayRes;
    }
  }

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

  // Dev-only role impersonation: attach the switcher's chosen role so the server
  // (which gates this header on dev-bypass) returns that role. Inert in Clerk builds.
  const devRoleOverride = getDevRoleOverride();
  if (devRoleOverride) {
    headers.set("x-dev-role-override", devRoleOverride);
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
