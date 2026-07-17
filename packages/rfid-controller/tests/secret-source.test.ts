import { describe, expect, it } from "vitest";

import { verifyVetTrackWebhookSignature } from "../../../server/integrations/webhooks/verify-signature";
import { buildEnvelope } from "../src/envelope";
import { RotatableSecretSource, StaticSecretSource, secretFromEnv } from "../src/secret-source";
import { signBody } from "../src/signer";

describe("StaticSecretSource", () => {
  it("returns the configured secret", () => {
    expect(new StaticSecretSource("s1").current()).toBe("s1");
  });
});

describe("RotatableSecretSource — hot-swap on rotation", () => {
  it("hot-swaps the signing secret without retaining the rotated-out plaintext", () => {
    const src = new RotatableSecretSource("old");
    expect(src.current()).toBe("old");
    src.rotate("new");
    expect(src.current()).toBe("new");
    // The rotated-out secret must NOT be exposed / retained (no `previous()`).
    expect((src as unknown as { previous?: unknown }).previous).toBeUndefined();
    expect(JSON.stringify(src)).not.toContain("old");
  });

  it("signing follows the hot-swapped secret (verified against the real verifier)", () => {
    const src = new RotatableSecretSource("old");
    const { body } = buildEnvelope([
      { tagEpc: "E1", gatewayCode: "GW-1", readAt: new Date("2026-07-17T18:00:00.000Z"), fromGateway: null },
    ]);
    const beforeHeader = signBody(body, src.current());
    expect(verifyVetTrackWebhookSignature(body, "old", beforeHeader)).toBe(true);

    src.rotate("new");
    const afterHeader = signBody(body, src.current());
    expect(afterHeader).not.toBe(beforeHeader);
    expect(verifyVetTrackWebhookSignature(body, "new", afterHeader)).toBe(true);
    // The controller signs with its ONE current secret and hot-swaps on rotation
    // — it never dual-signs. As a raw HMAC, a body signed under "new" does not
    // verify against "old". Rotation overlap is covered SERVER-SIDE: during the
    // grace window getRfidVerificationSecrets returns [current, previous] and the
    // ingest tries each, so a batch signed with the previous secret is still
    // accepted. That is a server property, asserted in the DB-integration e2e —
    // not a controller-side dual-sign.
    expect(verifyVetTrackWebhookSignature(body, "old", afterHeader)).toBe(false);
  });
});

describe("secretFromEnv", () => {
  it("reads the secret from the named env var (never from argv)", () => {
    const key = "RFID_TEST_SECRET_XYZ";
    process.env[key] = "env-secret";
    try {
      expect(secretFromEnv(key)).toBe("env-secret");
    } finally {
      delete process.env[key];
    }
  });

  it("throws when the env var is missing or empty", () => {
    const key = "RFID_TEST_SECRET_MISSING";
    delete process.env[key];
    expect(() => secretFromEnv(key)).toThrow();
    process.env[key] = "   ";
    try {
      expect(() => secretFromEnv(key)).toThrow();
    } finally {
      delete process.env[key];
    }
  });
});
