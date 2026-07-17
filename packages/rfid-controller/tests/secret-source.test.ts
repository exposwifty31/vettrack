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
  it("swaps the signing secret and retains the previous for observability", () => {
    const src = new RotatableSecretSource("old");
    expect(src.current()).toBe("old");
    expect(src.previous()).toBeNull();
    src.rotate("new");
    expect(src.current()).toBe("new");
    expect(src.previous()).toBe("old");
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
    // No server-side current-OR-previous grace verifier exists on this branch,
    // so the controller signs with the CURRENT secret only — it never dual-signs.
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
