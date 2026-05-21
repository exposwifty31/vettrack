/**
 * CI-safe flow: public health and version probes (read-only).
 */
import { test, expect } from "@playwright/test";
import { BASE_URL, expectHealthz } from "./_helpers";

test.describe("Flow: API health (read-only)", () => {
  test("GET /api/healthz returns ok", async ({ request }) => {
    await expectHealthz(request);
  });

  test("GET /api/version returns JSON with version field", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/version`);
    expect(res.status()).toBe(200);
    const json = (await res.json()) as { version?: string };
    expect(json.version).toBeTruthy();
  });
});
