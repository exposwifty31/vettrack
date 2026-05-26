/**
 * CI-safe flow: auth gates via dev-bypass headers (no Clerk mutations).
 */
import { test, expect } from "@playwright/test";
import { apiGet, devRoleHeaders } from "./_helpers";

test.describe("Flow: Auth gates (dev bypass)", () => {
  test("GET /api/users/me as admin returns 200", async ({ request }) => {
    const { status, body } = await apiGet(request, "/api/users/me", devRoleHeaders("admin"));
    expect(status).toBe(200);
    expect(body).toMatchObject({ role: "admin" });
  });

  test("GET /api/users/me as technician returns 200", async ({ request }) => {
    const { status, body } = await apiGet(request, "/api/users/me", devRoleHeaders("technician"));
    expect(status).toBe(200);
    expect(body).toMatchObject({ role: "technician" });
  });

  test("admin-only route denies technician", async ({ request }) => {
    const { status } = await apiGet(request, "/api/admin/outbox-health", devRoleHeaders("technician"));
    expect(status).toBe(403);
  });

  test("admin-only route allows admin", async ({ request }) => {
    const { status } = await apiGet(request, "/api/admin/outbox-health", devRoleHeaders("admin"));
    expect(status).toBe(200);
  });

  test("admin-only DLQ list denies technician", async ({ request }) => {
    const { status } = await apiGet(request, "/api/admin/outbox/dlq", devRoleHeaders("technician"));
    expect(status).toBe(403);
  });

  test("admin-only DLQ list allows admin", async ({ request }) => {
    const { status } = await apiGet(request, "/api/admin/outbox/dlq", devRoleHeaders("admin"));
    expect(status).toBe(200);
  });
});
