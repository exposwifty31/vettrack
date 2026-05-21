/** Flow CB-05: active Code Blue session read (no emergency mutations). */
import { test, expect } from "@playwright/test";
import { apiGet, devRoleHeaders } from "./_helpers";

test.describe("Flow: Code Blue read (CB-05)", () => {
  test("GET /api/code-blue/sessions/active returns 200", async ({ request }) => {
    const { status } = await apiGet(
      request,
      "/api/code-blue/sessions/active",
      devRoleHeaders("technician"),
    );
    expect(status).toBe(200);
  });
});
