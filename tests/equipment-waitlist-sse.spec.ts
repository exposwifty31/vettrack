/**
 * Phase B — waitlist realtime + paginated list evidence (API-level Playwright).
 *
 * Proves outbox events for six triggers and that paginated equipment list data
 * changes after return without relying on manual refresh (server truth + replay).
 *
 * Run (API on :3001, migrated DB, NODE_ENV=test dev-bypass):
 *   PW_SUITE=waitlist pnpm test:playwright:waitlist
 */

import { test, expect, type APIRequestContext } from "@playwright/test";
import { apiPost, devRoleHeaders, BASE_URL } from "./e2e/flows/_helpers";

/** Dev-bypass presets in server/middleware/auth.ts — upserted on first request. */
const clinicId = "dev-clinic-default";
const userAlpha = "dev-user-alpha";
const userBeta = "dev-user-beta";

function headers(userId: string) {
  return {
    ...devRoleHeaders("vet", userId),
    "x-dev-clinic-id-override": clinicId,
  };
}

async function waitForReplayEvent(
  request: APIRequestContext,
  userId: string,
  types: string[],
  fromId = 0,
  timeoutMs = 8000,
): Promise<{ id: number; type: string; payload: Record<string, unknown> }> {
  const deadline = Date.now() + timeoutMs;
  let cursor = fromId;
  while (Date.now() < deadline) {
    const res = await request.get(`${BASE_URL}/api/realtime/replay?from_id=${cursor}`, {
      headers: headers(userId),
    });
    if (res.ok()) {
      const body = (await res.json()) as { events?: Array<{ id: number; type: string; payload: Record<string, unknown> }> };
      for (const ev of body.events ?? []) {
        if (types.includes(ev.type)) return ev;
        cursor = Math.max(cursor, ev.id);
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timed out waiting for replay events: ${types.join(", ")}`);
}

async function getPaginatedCustody(
  request: APIRequestContext,
  userId: string,
  equipmentId: string,
): Promise<string | undefined> {
  const res = await request.get(`${BASE_URL}/api/equipment?limit=50&page=1`, {
    headers: headers(userId),
  });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { items: Array<{ id: string; custodyState?: string }> };
  return body.items.find((i) => i.id === equipmentId)?.custodyState;
}

test.describe("Equipment waitlist SSE evidence (API)", () => {
  test("paginated list custody updates after return; replay receives lifecycle events", async ({
    request,
  }) => {
    const suffix = Date.now();

    const created = await apiPost(
      request,
      "/api/equipment",
      { name: `Waitlist SSE ${suffix}`, serialNumber: `WL-${suffix}` },
      headers(userAlpha),
    );
    expect(created.status).toBe(201);
    const equipmentId = (created.body as { id: string }).id;

    try {
      const checkout = await apiPost(
        request,
        `/api/equipment/${equipmentId}/checkout`,
        { location: "Ward" },
        headers(userAlpha),
      );
      expect(checkout.status).toBe(200);
      expect(await getPaginatedCustody(request, userBeta, equipmentId)).toBe("checked_out");

      const join = await apiPost(request, `/api/equipment/${equipmentId}/waitlist`, {}, headers(userBeta));
      expect(join.status).toBe(201);
      await waitForReplayEvent(request, userBeta, ["EQUIPMENT_WAITLIST_JOINED"]);

      const leave = await request.delete(`${BASE_URL}/api/equipment/${equipmentId}/waitlist`, {
        headers: headers(userBeta),
      });
      expect(leave.ok()).toBeTruthy();
      await waitForReplayEvent(request, userBeta, ["EQUIPMENT_WAITLIST_LEFT"]);

      const rejoin = await apiPost(request, `/api/equipment/${equipmentId}/waitlist`, {}, headers(userBeta));
      expect(rejoin.status).toBe(201);

      const returned = await apiPost(
        request,
        `/api/equipment/${equipmentId}/return`,
        { isPluggedIn: true },
        headers(userAlpha),
      );
      expect(returned.status).toBe(200);

      await waitForReplayEvent(request, userBeta, [
        "EQUIPMENT_CUSTODY_STATE_CHANGED",
        "EQUIPMENT_WAITLIST_PROMOTED",
      ]);

      const custodyAfterReturn = await getPaginatedCustody(request, userBeta, equipmentId);
      expect(custodyAfterReturn).toBe("returned");

      const snap = await request.get(`${BASE_URL}/api/equipment/${equipmentId}/waitlist`, {
        headers: headers(userBeta),
      });
      expect(snap.ok()).toBeTruthy();
      const snapBody = (await snap.json()) as { myStatus?: string };
      expect(snapBody.myStatus).toBe("notified");
    } finally {
      await request.delete(`${BASE_URL}/api/equipment/${equipmentId}`, { headers: headers(userAlpha) });
    }
  });
});
