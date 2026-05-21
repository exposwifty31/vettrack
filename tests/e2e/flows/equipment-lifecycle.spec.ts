/** Flow EQ-05/06: quick scan checkout toggle (API, dev bypass). */
import { test, expect } from "@playwright/test";
import { apiPost, devRoleHeaders } from "./_helpers";

test.describe("Flow: Equipment scan lifecycle (EQ-05)", () => {
  test("POST /api/equipment/scan checks out then returns for same user", async ({ request }) => {
    const headers = devRoleHeaders("admin", "dev-user-alpha");
    const suffix = Date.now();
    const created = await apiPost(
      request,
      "/api/equipment",
      { name: `Lifecycle ${suffix}`, serialNumber: `LC-${suffix}` },
      headers,
    );
    expect(created.status).toBe(201);
    const id = (created.body as { id: string }).id;

    try {
      const checkout = await apiPost(request, "/api/equipment/scan", { equipmentId: id }, headers);
      expect(checkout.status).toBe(200);
      expect((checkout.body as { action: string }).action).toBe("checkout");

      const ret = await apiPost(request, "/api/equipment/scan", { equipmentId: id }, headers);
      expect(ret.status).toBe(200);
      expect((ret.body as { action: string }).action).toBe("return");
    } finally {
      await request.delete(`/api/equipment/${id}`, { headers });
    }
  });
});
