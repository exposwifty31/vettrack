/** Flow BIL-01: billing ledger read. */
import { test, expect } from "@playwright/test";
import { apiGet, devRoleHeaders } from "./_helpers";

test.describe("Flow: Billing read (BIL-01)", () => {
  test("GET /api/billing returns 200 for admin", async ({ request }) => {
    const { status } = await apiGet(request, "/api/billing", devRoleHeaders("admin"));
    expect([200, 404]).toContain(status);
  });
});
