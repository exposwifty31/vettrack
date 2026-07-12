/**
 * @vitest-environment happy-dom
 *
 * T-24c — client api + types for the damage-report feature (R-EQ-F3). Mocks
 * the fetch layer and asserts `api.equipment.reportDamage()` POSTs the
 * equipmentId + note payload to the flat locate-style mount
 * `/api/equipment/damage-reports` (mirrors the `/api/equipment/locate`
 * precedent in server/routes/equipment-locate.ts — both are "cross equipment"
 * reads/writes mounted at the equipment base path rather than nested under
 * `:id`) and returns the typed `{ damageEvent, conditionStatus }` shape. The
 * backend route (T-24b) lands in a sibling card — this locks the contract the
 * schema (T-24a, `vt_damage_events`: id/clinicId/equipmentId/reportedBy/at/
 * note/resolvedAt/createdAt) implies.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { setAuthState } from "@/lib/auth-store";
import type { DamageReport } from "@/types";

describe("api.equipment.reportDamage", () => {
  beforeEach(() => {
    // A JWT-shaped (3-part) bearer token satisfies authFetch's isValidJwt check
    // regardless of whether this environment resolves Clerk-enabled or
    // dev-bypass — this test only cares about the URL/payload/response shape.
    setAuthState({ userId: "dev-user-1", email: "tech@clinic.test", name: "Tech", bearerToken: "aaa.bbb.ccc" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs { equipmentId, note } to /api/equipment/damage-reports and returns the typed shape", async () => {
    const damageEvent: DamageReport = {
      id: "dmg-1",
      clinicId: "clinic-1",
      equipmentId: "eq-1",
      reportedBy: "dev-user-1",
      at: "2026-07-12T00:00:00.000Z",
      note: "Cracked housing",
      resolvedAt: null,
      createdAt: "2026-07-12T00:00:00.000Z",
    };
    const responseBody = { damageEvent, conditionStatus: "damaged" };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(responseBody), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await api.equipment.reportDamage({ equipmentId: "eq-1", note: "Cracked housing" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/equipment/damage-reports");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ equipmentId: "eq-1", note: "Cracked housing" });
    expect(result).toEqual(responseBody);
  });

  it("omits note from the payload when not provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ damageEvent: {}, conditionStatus: "damaged" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.equipment.reportDamage({ equipmentId: "eq-2" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ equipmentId: "eq-2" });
  });
});
