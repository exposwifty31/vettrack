/**
 * R-RTC-1.1 — bridge a handshake bearer token to the app's existing session→DB
 * identity path (`resolveAuthUser`). Identity (role, clinicId, userId) is ALWAYS
 * read from the DB session; nothing here trusts a client claim.
 */
import type { Request } from "express";
import { authenticateRequest, clerkClient } from "@clerk/express";
import { resolveAuthUser } from "../../middleware/auth.js";
import { resolveAuthModeFromEnv } from "../auth-mode.js";
import { COLLAB_SOCKET_PATH } from "./config.js";
import type { CollabIdentity } from "./rooms.js";
import type { ResolveHandshakeIdentity } from "./handshake.js";

/**
 * Global brand `clerkMiddleware` installs on `req.auth` so `getAuth(req)` accepts
 * it. `Symbol.for` keeps the key stable across package copies (Clerk's own
 * contract), so branding the pseudo request here is equivalent to having run the
 * middleware — without the Express middleware chain the handshake never enters.
 */
const CLERK_AUTH_BRAND = Symbol.for("@clerk/express.auth");

/**
 * Build the minimal `Request`-like shape `resolveAuthUser` reads: the bearer token
 * as an `Authorization` header, plus the dev-bypass override headers (honored only
 * when the server is actually in dev-bypass mode).
 *
 * In Clerk mode the Socket.io handshake never passes through `clerkMiddleware`, so
 * a later `getAuth(req)` inside `resolveAuthUser` would throw ("clerkMiddleware
 * should be registered before using getAuth") — the bug this fixes, which rejected
 * every production handshake. We instead authenticate the bearer token directly via
 * `authenticateRequest` (JWKS-based; requires no middleware) and brand `req.auth`
 * exactly as `clerkMiddleware` does, so the shared `resolveAuthUser` → `getAuth` →
 * DB path resolves the DB-backed identity unchanged. Dev-bypass never reaches
 * `getAuth`, so it is left untouched.
 */
export const resolveHandshakeIdentity: ResolveHandshakeIdentity = async (token, devHeaders) => {
  const headers: Record<string, string | undefined> = {
    authorization: `Bearer ${token}`,
    "x-dev-role-override": devHeaders["x-dev-role-override"],
    "x-dev-user-id-override": devHeaders["x-dev-user-id-override"],
    "x-dev-clinic-id-override": devHeaders["x-dev-clinic-id-override"],
  };
  const pseudo = {
    headers,
    method: "GET",
    url: COLLAB_SOCKET_PATH,
    socket: {},
    ip: "",
  } as unknown as Request;

  if (resolveAuthModeFromEnv().mode === "clerk") {
    try {
      const requestState = await authenticateRequest({ clerkClient, request: pseudo });
      const authHandler = Object.assign(
        (opts?: Parameters<typeof requestState.toAuth>[0]) => requestState.toAuth(opts),
        { [CLERK_AUTH_BRAND]: true },
      );
      Object.assign(pseudo, { auth: authHandler });
    } catch (err) {
      // A transient Clerk/JWKS failure must reject THIS handshake (return null),
      // never throw into the caller — the channel stays additive and non-fatal.
      console.error("[collab-ws] handshake token authentication failed", err);
      return null;
    }
  }

  const result = await resolveAuthUser(pseudo);
  if (!result.ok) return null;
  const user = result.user;
  if (!user.clinicId) return null;
  const identity: CollabIdentity = {
    userId: user.id,
    clinicId: user.clinicId,
    role: String(user.role),
    displayName: user.name ?? "Unknown",
  };
  return identity;
};
