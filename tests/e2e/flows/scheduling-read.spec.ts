/** Flow SCH-01: appointments/tasks list read. */
import { test, expect } from "@playwright/test";
import { apiGet, devRoleHeaders } from "./_helpers";

test.describe("Flow: Scheduling read (SCH-01)", () => {
  test("GET /api/appointments returns 200 for vet", async ({ request }) => {
    const today = new Date().toISOString().slice(0, 10);
    const { status } = await apiGet(request, `/api/appointments?day=${today}`, devRoleHeaders("vet"));
    expect(status).toBe(200);
  });

  test("GET /api/tasks/me returns 200 for technician", async ({ request }) => {
    const { status } = await apiGet(request, "/api/tasks/me", devRoleHeaders("technician"));
    expect(status).toBe(200);
  });
});
