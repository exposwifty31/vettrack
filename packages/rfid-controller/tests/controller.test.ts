import { describe, expect, it, vi } from "vitest";

import { verifyVetTrackWebhookSignature } from "../../../server/integrations/webhooks/verify-signature";
import { SyntheticAdapter } from "../src/adapter";
import { loadConfig } from "../src/config";
import { RfidController } from "../src/controller";
import { StaticSecretSource } from "../src/secret-source";
import { HttpSender } from "../src/sender";

const SECRET = "clinic-secret";

function controllerWithFetch(fetchFn: typeof fetch) {
  const config = loadConfig({
    apiOrigin: "https://api.test",
    clinicId: "clinic-a",
    controllerVersion: "vettrack-rfid/test",
    debounceMs: 1_000,
  });
  const sender = new HttpSender({ apiOrigin: config.apiOrigin, clinicId: config.clinicId, fetchFn });
  return new RfidController({ config, secretSource: new StaticSecretSource(SECRET), sender });
}

describe("RfidController — end-to-end pipeline (no DB, injected fetch)", () => {
  it("aggregates a read burst into a single signed, well-formed POST the real verifier accepts", async () => {
    const captured: { body: Buffer; signature: string }[] = [];
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      captured.push({
        body: init.body as Buffer,
        signature: headers.get("x-vettrack-signature") ?? "",
      });
      return new Response(JSON.stringify({ ok: true, accepted: 1, updated: 1 }), { status: 202 });
    }) as unknown as typeof fetch;

    const base = 1_800_000_000_000;
    // E1 crosses into GW-2 then is re-read 99 more times at GW-2 (one crossing).
    const reads = Array.from({ length: 100 }, (_, i) => ({
      tagEpc: "E1",
      gatewayCode: "GW-2",
      readAt: new Date(base + i * 10),
    }));

    const summary = await controllerWithFetch(fetchFn).run(new SyntheticAdapter(reads));

    expect(summary.readsProcessed).toBe(100);
    expect(summary.batches).toBe(1);
    expect(summary.accepted).toBe(1);
    expect(captured).toHaveLength(1);
    // The signature over the exact posted body verifies with the real oracle.
    expect(verifyVetTrackWebhookSignature(captured[0].body, SECRET, captured[0].signature)).toBe(true);
    // Wire body carries only the neutral event fields.
    const parsed = JSON.parse(captured[0].body.toString("utf8"));
    expect(Object.keys(parsed.events[0]).sort()).toEqual(["gatewayCode", "readAt", "tagEpc"]);
  });

  it("surfaces a dropped validation outcome without buffering", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, code: "INVALID_SIGNATURE" }), { status: 401 }),
    ) as unknown as typeof fetch;
    const summary = await controllerWithFetch(fetchFn).run(
      new SyntheticAdapter([{ tagEpc: "E1", gatewayCode: "GW-1", readAt: new Date(1_800_000_000_000) }]),
    );
    expect(summary.dropped).toBe(1);
    expect(summary.accepted).toBe(0);
  });
});
