/**
 * CI-safe flow: equipment list read (no checkout/return mutations).
 */
import { test, expect } from "@playwright/test";
import { apiGet, devRoleHeaders } from "./_helpers";

test.describe("Flow: Equipment read", () => {
  test("GET /api/equipment returns 200 for admin", async ({ request }) => {
    const { status, body } = await apiGet(request, "/api/equipment", devRoleHeaders("admin"));
    expect(status).toBe(200);
    expect(Array.isArray(body) || (body && typeof body === "object")).toBe(true);
  });

  test("GET /api/equipment/:id returns 200 or 404 for seeded eq1", async ({ request }) => {
    const { status } = await apiGet(request, "/api/equipment/eq1", devRoleHeaders("admin"));
    expect([200, 404]).toContain(status);
  });
});
