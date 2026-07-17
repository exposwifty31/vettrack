/**
 * R-RTC-1.1 — authenticated Socket.io handshake (the bot's fatal flaw, fixed).
 *
 * Order of checks (each rejects BEFORE the next):
 *   1. Origin allowlist (CSWSH defense) — reject an untrusted origin before we
 *      ever look at the session.
 *   2. Bearer token present in `handshake.auth` — a cookie-only (ambient) handshake
 *      is rejected; the session must be an explicit bearer token.
 *   3. Session → DB identity. `role` + `clinicId` come from the DB session, NEVER
 *      from `handshake.auth.userId` (a client-claimed userId is ignored entirely).
 *
 * Written as a pure function over an injected `ResolveHandshakeIdentity` so every
 * rejection is unit-testable without a live socket server.
 */
import { isOriginAllowed } from "./config.js";
import type { CollabIdentity } from "./rooms.js";

export interface HandshakeInput {
  /** The `Origin` request header from the WS upgrade. */
  origin: string | undefined;
  /** The bearer session token the client puts in `socket.handshake.auth.token`. */
  authToken: string | undefined;
  /** Anything the client CLAIMS about itself — deliberately ignored for identity. */
  claimedUserId?: unknown;
  /** Dev-bypass role/user/clinic override headers (honored only in dev-bypass mode). */
  devHeaders?: Record<string, string | undefined>;
}

/**
 * Resolve a validated session token to a DB-backed identity, or null if the token
 * is invalid/unauthenticated. Injected so the handshake reuses the app's existing
 * session→DB path (`resolveAuthUser`) and tests can supply a stub.
 */
export type ResolveHandshakeIdentity = (
  token: string,
  devHeaders: Record<string, string | undefined>,
) => Promise<CollabIdentity | null>;

export type HandshakeResult =
  | { ok: true; identity: CollabIdentity }
  | { ok: false; reason: "UNTRUSTED_ORIGIN" | "MISSING_BEARER_TOKEN" | "UNAUTHENTICATED" };

export async function validateHandshake(
  input: HandshakeInput,
  resolveIdentity: ResolveHandshakeIdentity,
  env: NodeJS.ProcessEnv = process.env,
): Promise<HandshakeResult> {
  // 1. Origin allowlist — reject before touching the session (CSWSH).
  if (!isOriginAllowed(input.origin, env)) {
    return { ok: false, reason: "UNTRUSTED_ORIGIN" };
  }
  // 2. Require an explicit bearer token — cookie-only handshakes are rejected.
  if (typeof input.authToken !== "string" || input.authToken.trim() === "") {
    return { ok: false, reason: "MISSING_BEARER_TOKEN" };
  }
  // 3. DB-sourced identity. The client-claimed userId is never read here.
  const identity = await resolveIdentity(input.authToken, input.devHeaders ?? {});
  if (!identity) return { ok: false, reason: "UNAUTHENTICATED" };
  return { ok: true, identity };
}
