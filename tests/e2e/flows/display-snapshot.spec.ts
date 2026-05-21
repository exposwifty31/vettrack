/** Flow DISP-01: ward display snapshot read. */
import { test, expect } from "@playwright/test";
import { apiGet, devRoleHeaders } from "./_helpers";

test.describe("Flow: Display snapshot (DISP-01)", () => {
  test("GET /api/display/snapshot returns 200", async ({ request }) => {
    const { status } = await apiGet(request, "/api/display/snapshot", devRoleHeaders("admin"));
    expect(status).toBe(200);
  });
});
