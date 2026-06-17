/**
 * Sign in with Apple — server-to-server REST helpers.
 *
 * Used by the in-app account-deletion flow (App Store Guideline 5.1.1(v)).
 * Apple requires apps that offer Sign in with Apple to revoke the user's tokens
 * via the REST API when the account is deleted. To do that we need an Apple
 * refresh token, which we obtain by exchanging the `authorizationCode` captured
 * at sign-in.
 *
 * The client secret is an ES256-signed JWT. We sign it with Node's built-in
 * `crypto` (the `.p8` is a PKCS#8 EC P-256 key) using the JOSE `ieee-p1363`
 * raw r||s signature encoding — so no extra JWT dependency is needed.
 *
 * Configuration (all four required to enable revocation):
 *   APPLE_TEAM_ID     — JWT `iss` (10-char Team ID / App ID Prefix)
 *   APPLE_KEY_ID      — JWT header `kid` (the Sign in with Apple key)
 *   APPLE_CLIENT_ID   — JWT `sub` + revoke `client_id` (Services ID / bundle ID)
 *   APPLE_PRIVATE_KEY — the `.p8` contents (literal `\n` escapes tolerated)
 */
import { createSign } from "crypto";

const APPLE_AUTH_BASE = "https://appleid.apple.com";
/** Apple caps client_secret `exp` at 6 months (15777000s). Stay well under. */
const CLIENT_SECRET_TTL_SECONDS = 150 * 24 * 60 * 60; // 150 days

export interface AppleAuthConfig {
  teamId: string;
  keyId: string;
  clientId: string;
  privateKey: string;
}

function readConfig(): AppleAuthConfig | null {
  const teamId = process.env.APPLE_TEAM_ID?.trim();
  const keyId = process.env.APPLE_KEY_ID?.trim();
  const clientId = process.env.APPLE_CLIENT_ID?.trim();
  const rawKey = process.env.APPLE_PRIVATE_KEY;
  if (!teamId || !keyId || !clientId || !rawKey) return null;
  // Env stores the PEM as a single line with escaped newlines; restore them.
  const privateKey = rawKey.includes("\\n") ? rawKey.replace(/\\n/g, "\n") : rawKey;
  if (!privateKey.includes("BEGIN")) return null;
  return { teamId, keyId, clientId, privateKey };
}

/** True when all four Apple secrets are present and revocation can run. */
export function isAppleRevocationConfigured(): boolean {
  return readConfig() !== null;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * Build the ES256 client_secret JWT Apple expects for `/auth/token` and
 * `/auth/revoke`. Exported for testing.
 */
export function buildAppleClientSecret(config: AppleAuthConfig, now: number = Math.floor(Date.now() / 1000)): string {
  const header = { alg: "ES256", kid: config.keyId, typ: "JWT" };
  const payload = {
    iss: config.teamId,
    iat: now,
    exp: now + CLIENT_SECRET_TTL_SECONDS,
    aud: APPLE_AUTH_BASE,
    sub: config.clientId,
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signer = createSign("SHA256");
  signer.update(signingInput);
  signer.end();
  // `ieee-p1363` yields the raw 64-byte r||s signature JOSE requires (not DER).
  const signature = signer.sign({ key: config.privateKey, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${base64url(signature)}`;
}

/** Decode (without verifying) the `sub` claim from an Apple id_token. */
function decodeIdTokenSub(idToken: string | undefined): string | null {
  if (!idToken) return null;
  const parts = idToken.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { sub?: string };
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export class AppleAuthError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "AppleAuthError";
    this.status = status;
  }
}

export interface AppleTokenExchangeResult {
  refreshToken: string;
  accessToken: string | null;
  appleSub: string | null;
}

/**
 * Exchange a single-use Apple `authorizationCode` (valid ~5 minutes) for a
 * refresh token at `POST /auth/token`. Throws `AppleAuthError` on failure.
 */
export async function exchangeAppleAuthorizationCode(
  authorizationCode: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AppleTokenExchangeResult> {
  const config = readConfig();
  if (!config) throw new AppleAuthError("Apple revocation is not configured", 501);

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: authorizationCode,
    client_id: config.clientId,
    client_secret: buildAppleClientSecret(config),
  });

  let res: Response;
  try {
    res = await fetchImpl(`${APPLE_AUTH_BASE}/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch (err) {
    throw new AppleAuthError(`Apple token exchange request failed: ${String(err)}`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new AppleAuthError(`Apple token exchange returned ${res.status}: ${detail.slice(0, 200)}`);
  }

  const json = (await res.json().catch(() => ({}))) as {
    refresh_token?: string;
    access_token?: string;
    id_token?: string;
  };
  if (!json.refresh_token) {
    throw new AppleAuthError("Apple token exchange did not return a refresh_token");
  }
  return {
    refreshToken: json.refresh_token,
    accessToken: json.access_token ?? null,
    appleSub: decodeIdTokenSub(json.id_token),
  };
}

export type AppleTokenTypeHint = "refresh_token" | "access_token";

/**
 * Revoke a stored Apple token at `POST /auth/revoke`.
 *
 * Apple returns HTTP 200 with an empty body even for already-invalid tokens,
 * so a resolved promise means "the request was accepted", not "the token was
 * definitely live". A non-2xx status (e.g. 400 `invalid_client`) throws.
 */
export async function revokeAppleToken(
  token: string,
  tokenTypeHint: AppleTokenTypeHint = "refresh_token",
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const config = readConfig();
  if (!config) throw new AppleAuthError("Apple revocation is not configured", 501);

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: buildAppleClientSecret(config),
    token,
    token_type_hint: tokenTypeHint,
  });

  let res: Response;
  try {
    res = await fetchImpl(`${APPLE_AUTH_BASE}/auth/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch (err) {
    throw new AppleAuthError(`Apple revoke request failed: ${String(err)}`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new AppleAuthError(`Apple revoke returned ${res.status}: ${detail.slice(0, 200)}`);
  }
}
