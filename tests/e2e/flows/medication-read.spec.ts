/** Flow MED-05: medication task list read. */
import { test, expect } from "@playwright/test";
import { apiGet, devRoleHeaders } from "./_helpers";

test.describe("Flow: Medication tasks read (MED-05)", () => {
  test("GET /api/medication-tasks returns 200 for technician", async ({ request }) => {
    const { status } = await apiGet(request, "/api/medication-tasks", devRoleHeaders("technician"));
    expect(status).toBe(200);
  });
});
