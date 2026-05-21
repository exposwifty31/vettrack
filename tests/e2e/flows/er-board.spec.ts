/** Flow ER-02: ER board read. */
import { test, expect } from "@playwright/test";
import { apiGet, devRoleHeaders } from "./_helpers";

test.describe("Flow: ER board (ER-02)", () => {
  test("GET /api/er/board returns 200 for technician", async ({ request }) => {
    const { status } = await apiGet(request, "/api/er/board", devRoleHeaders("technician"));
    expect(status).toBe(200);
  });
});
