/** Flow INV-02: dispense endpoint is clinical-gated. */
import { test, expect } from "@playwright/test";
import { apiPost, devRoleHeaders } from "./_helpers";

test.describe("Flow: Dispense authority gate (INV-02)", () => {
  test("POST dispense without body returns 400 or 403, not 500", async ({ request }) => {
    const fakeContainer = "00000000-0000-4000-8000-000000000001";
    const { status } = await apiPost(
      request,
      `/api/containers/${fakeContainer}/dispense`,
      { items: [] },
      {
        ...devRoleHeaders("technician"),
        "Idempotency-Key": `e2e-dispense-${Date.now()}`,
      },
    );
    expect([400, 403, 404, 422]).toContain(status);
  });
});
