import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createVerify, generateKeyPairSync } from "crypto";
import {
  AppleAuthError,
  buildAppleClientSecret,
  exchangeAppleAuthorizationCode,
  isAppleRevocationConfigured,
  revokeAppleToken,
  type AppleAuthConfig,
} from "../server/lib/apple-auth.js";

// A real P-256 keypair so we can verify the ES256 signatures we produce.
const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const config: AppleAuthConfig = {
  teamId: "TEAM123456",
  keyId: "KEY1234567",
  clientId: "uk.vettrack.app.signin",
  privateKey,
};

function decodeSegment(seg: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(seg, "base64url").toString("utf8"));
}

describe("buildAppleClientSecret", () => {
  it("produces a verifiable ES256 JWT with the documented claims", () => {
    const now = 1_700_000_000;
    const jwt = buildAppleClientSecret(config, now);
    const [headerB64, payloadB64, signatureB64] = jwt.split(".");

    const header = decodeSegment(headerB64);
    expect(header).toMatchObject({ alg: "ES256", kid: config.keyId, typ: "JWT" });

    const payload = decodeSegment(payloadB64);
    expect(payload).toMatchObject({
      iss: config.teamId,
      sub: config.clientId,
      aud: "https://appleid.apple.com",
      iat: now,
    });
    // exp must be within 6 months (15777000s) of iat.
    expect((payload.exp as number) - now).toBeGreaterThan(0);
    expect((payload.exp as number) - now).toBeLessThanOrEqual(15_777_000);

    // The signature must verify against the public key (raw r||s / JOSE form).
    const verifier = createVerify("SHA256");
    verifier.update(`${headerB64}.${payloadB64}`);
    verifier.end();
    const valid = verifier.verify(
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signatureB64, "base64url"),
    );
    expect(valid).toBe(true);
  });
});

describe("isAppleRevocationConfigured", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  it("is false when any Apple secret is missing", () => {
    delete process.env.APPLE_TEAM_ID;
    delete process.env.APPLE_KEY_ID;
    delete process.env.APPLE_CLIENT_ID;
    delete process.env.APPLE_PRIVATE_KEY;
    expect(isAppleRevocationConfigured()).toBe(false);
  });

  it("is true when all four secrets are present", () => {
    process.env.APPLE_TEAM_ID = config.teamId;
    process.env.APPLE_KEY_ID = config.keyId;
    process.env.APPLE_CLIENT_ID = config.clientId;
    process.env.APPLE_PRIVATE_KEY = config.privateKey;
    expect(isAppleRevocationConfigured()).toBe(true);
  });
});

describe("exchangeAppleAuthorizationCode", () => {
  beforeEach(() => {
    process.env.APPLE_TEAM_ID = config.teamId;
    process.env.APPLE_KEY_ID = config.keyId;
    process.env.APPLE_CLIENT_ID = config.clientId;
    process.env.APPLE_PRIVATE_KEY = config.privateKey;
  });

  it("returns the refresh token and posts the expected form to Apple", async () => {
    const idTokenPayload = Buffer.from(JSON.stringify({ sub: "001234.abcdef" })).toString("base64url");
    const idToken = `h.${idTokenPayload}.s`;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = (init?.body as URLSearchParams).toString();
      expect(body).toContain("grant_type=authorization_code");
      expect(body).toContain("code=AUTHCODE");
      return new Response(
        JSON.stringify({ refresh_token: "rt_123", access_token: "at_123", id_token: idToken }),
        { status: 200 },
      );
    });

    const result = await exchangeAppleAuthorizationCode("AUTHCODE", fetchMock as unknown as typeof fetch);
    expect(result.refreshToken).toBe("rt_123");
    expect(result.accessToken).toBe("at_123");
    expect(result.appleSub).toBe("001234.abcdef");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("throws AppleAuthError on a non-2xx response", async () => {
    const fetchMock = vi.fn(async () => new Response("invalid_grant", { status: 400 }));
    await expect(
      exchangeAppleAuthorizationCode("BAD", fetchMock as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(AppleAuthError);
  });

  it("throws when Apple omits the refresh_token", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: "at" }), { status: 200 }));
    await expect(
      exchangeAppleAuthorizationCode("CODE", fetchMock as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(AppleAuthError);
  });
});

describe("revokeAppleToken", () => {
  beforeEach(() => {
    process.env.APPLE_TEAM_ID = config.teamId;
    process.env.APPLE_KEY_ID = config.keyId;
    process.env.APPLE_CLIENT_ID = config.clientId;
    process.env.APPLE_PRIVATE_KEY = config.privateKey;
  });

  it("resolves on HTTP 200 (empty body) and sends the token + hint", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = (init?.body as URLSearchParams).toString();
      expect(body).toContain("token=rt_xyz");
      expect(body).toContain("token_type_hint=refresh_token");
      return new Response("", { status: 200 });
    });
    await expect(
      revokeAppleToken("rt_xyz", "refresh_token", fetchMock as unknown as typeof fetch),
    ).resolves.toBeUndefined();
  });

  it("throws AppleAuthError on a 400 invalid_client", async () => {
    const fetchMock = vi.fn(async () => new Response("invalid_client", { status: 400 }));
    await expect(
      revokeAppleToken("rt", "refresh_token", fetchMock as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(AppleAuthError);
  });
});
