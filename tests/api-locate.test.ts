/**
 * @vitest-environment happy-dom
 *
 * T-22b — client wiring for the read-only locate endpoint (R-EQ-F1). Mocks
 * the fetch layer (per sibling tests/dev-role-override.test.ts pattern) and
 * asserts `api.equipment.locate(q)` calls `GET /api/equipment/locate?q=` with
 * the query URL-encoded, and returns the typed shape from
 * server/routes/equipment-locate.ts (`{ query, results: [...] }`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { setAuthState } from "@/lib/auth-store";
import type { EquipmentLocateResponse } from "@/types/locate";

describe("api.equipment.locate", () => {
  beforeEach(() => {
    // A JWT-shaped (3-part) bearer token satisfies authFetch's isValidJwt check
    // regardless of whether this environment resolves Clerk-enabled or
    // dev-bypass — this test only cares about the URL + response shape.
    setAuthState({ userId: "dev-user-1", email: "tech@clinic.test", name: "Tech", bearerToken: "aaa.bbb.ccc" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls GET /api/equipment/locate with the q param and returns the typed shape", async () => {
    const body: EquipmentLocateResponse = {
      query: "stryker",
      results: [
        {
          equipmentId: "eq-1",
          name: "Stryker Bed",
          location: { summary: "room:ICU", claims: [], unknowns: [] },
          custodian: { claims: [], unknowns: ["no_active_custodian"], lastCorroboratedAt: null },
          readiness: "ready",
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await api.equipment.locate("stryker");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/equipment/locate?q=stryker");
    expect(result).toEqual(body);
  });

  it("URL-encodes special characters in the query", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ query: "a b/c?", results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.equipment.locate("a b/c?");

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/equipment/locate?q=${encodeURIComponent("a b/c?")}`);
  });

  it("rejects when the server returns a non-200 response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "boom" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.equipment.locate("stryker")).rejects.toThrow();
  });
});
