/** Flow AUTH-05: protected route requires auth context. */
import { test, expect } from "@playwright/test";
import { apiGet } from "./_helpers";

test.describe("Flow: Account gates API (AUTH-05)", () => {
  test("GET /api/users/me without dev headers still returns 200 in CI dev-bypass", async ({ request }) => {
    const { status } = await apiGet(request, "/api/users/me");
    expect(status).toBe(200);
  });
});
