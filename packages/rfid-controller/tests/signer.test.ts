import { describe, expect, it } from "vitest";

// Oracle: the REAL server-side verifier the ingest uses. The signer must
// produce a header this function accepts, byte-for-byte.
import { verifyVetTrackWebhookSignature } from "../../../server/integrations/webhooks/verify-signature";
import { buildEnvelope } from "../src/envelope";
import { signBody } from "../src/signer";

const SECRET = "per-clinic-webhook-secret";

function bodyBuf() {
  return buildEnvelope([{ tagEpc: "E280", gatewayCode: "GW-1", readAt: new Date("2026-07-17T18:00:00.000Z"), fromGateway: null }]).body;
}

describe("signBody", () => {
  it("produces a sha256= lowercase-hex header the real verifier accepts", () => {
    const body = bodyBuf();
    const header = signBody(body, SECRET);
    expect(header).toMatch(/^sha256=[0-9a-f]+$/);
    expect(verifyVetTrackWebhookSignature(body, SECRET, header)).toBe(true);
  });

  it("fails verification under the wrong secret", () => {
    const body = bodyBuf();
    const header = signBody(body, "wrong-secret");
    expect(verifyVetTrackWebhookSignature(body, SECRET, header)).toBe(false);
  });

  it("fails verification if the body is tampered after signing", () => {
    const body = bodyBuf();
    const header = signBody(body, SECRET);
    const tampered = Buffer.from(body.toString("utf8").replace("GW-1", "GW-9"), "utf8");
    expect(verifyVetTrackWebhookSignature(tampered, SECRET, header)).toBe(false);
  });

  it("must sign THE SAME buffer that is sent — re-serialized bytes break the HMAC", () => {
    const { batch, body } = buildEnvelope([
      { tagEpc: "E280", gatewayCode: "GW-1", readAt: new Date("2026-07-17T18:00:00.000Z"), fromGateway: null },
    ]);
    const header = signBody(body, SECRET);
    // A naive re-serialization (semantically equal, but not guaranteed identical bytes).
    const reserialized = Buffer.from(JSON.stringify(batch) + " ", "utf8");
    expect(verifyVetTrackWebhookSignature(reserialized, SECRET, header)).toBe(false);
    // The original canonical buffer still verifies.
    expect(verifyVetTrackWebhookSignature(body, SECRET, header)).toBe(true);
  });
});
