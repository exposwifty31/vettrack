/**
 * Flow CO-04: rapid double checkout on the same equipment stays idempotent (409 or single holder).
 * CI-safe API flow — uses dev-bypass headers; requires seed:dev:e2e fixture equipment.
 */
import { test, expect } from "@playwright/test";
import { apiGet, apiPost, devRoleHeaders } from "./_helpers";

test.describe("Flow: Equipment duplicate submit (CO-04)", () => {
  test("parallel checkout on available equipment yields at most one holder", async ({ request }) => {
    const headers = devRoleHeaders("admin", "dev-user-alpha");
    const create = await apiPost(
      request,
      "/api/equipment",
      {
        name: `Dup-scan E2E ${Date.now()}`,
        serialNumber: `DUP-${Date.now()}`,
        location: "Lab",
      },
      headers,
    );
    expect(create.status).toBe(201);
    const equipmentId = (create.body as { id: string }).id;

    try {
      const [first, second] = await Promise.all([
        apiPost(request, `/api/equipment/${equipmentId}/checkout`, {}, headers),
        apiPost(request, `/api/equipment/${equipmentId}/checkout`, {}, headers),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 409]);

      const after = await apiGet(request, `/api/equipment/${equipmentId}`, headers);
      expect(after.status).toBe(200);
      const row = after.body as { checkedOutById?: string | null };
      expect(row.checkedOutById).toBeTruthy();
    } finally {
      await request.delete(`/api/equipment/${equipmentId}`, { headers });
    }
  });
});
