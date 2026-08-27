/**
 * S13b — finishing a restock session that counted nothing must be refused.
 *
 * A technician can open a session, scan nothing, and press Finish. Today that
 * closes the session as a completed restock with zero counts recorded, which
 * makes an uncounted container look audited. The service must refuse it with a
 * 400 NO_ITEMS_COUNTED and leave the session active so it can still be counted
 * (or cancelled).
 *
 * Requires DATABASE_URL and the inventory migrations applied.
 * Run: pnpm exec vitest run tests/restock-finish-no-items-counted.test.ts
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import {
  clinics,
  containerItems,
  containers,
  db,
  inventoryItems,
  inventoryLogs,
  pool,
  restockSessions,
  users,
} from "../server/db.js";
import {
  RestockServiceError,
  finishSession,
  startRestockSession,
} from "../server/services/restock.service.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "";

async function purgeClinic(clinicId: string) {
  await db.delete(inventoryLogs).where(eq(inventoryLogs.clinicId, clinicId));
  await db.delete(restockSessions).where(eq(restockSessions.clinicId, clinicId));
  await db.delete(containerItems).where(eq(containerItems.clinicId, clinicId));
  await db.delete(containers).where(eq(containers.clinicId, clinicId));
  await db.delete(inventoryItems).where(eq(inventoryItems.clinicId, clinicId));
  await db.delete(users).where(eq(users.clinicId, clinicId));
  await db.delete(clinics).where(eq(clinics.id, clinicId));
}

async function seedHospitalCart() {
  const clinicId = randomUUID();
  const userId = randomUUID();
  const containerId = randomUUID();
  await db.insert(clinics).values({ id: clinicId });
  await db.insert(users).values({
    id: userId,
    clinicId,
    clerkId: `clerk_${randomUUID()}`,
    email: `u_${randomUUID()}@example.com`,
    name: "Restock Tech",
  });
  await db.insert(containers).values({
    id: containerId,
    clinicId,
    name: "Hospital Supply Cart",
    department: "Hospital",
  });
  return { clinicId, userId, containerId };
}

describe.skipIf(!DATABASE_URL)("finishSession with nothing counted", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("refuses to finish a session with no scans and leaves it active", async () => {
    const { clinicId, userId, containerId } = await seedHospitalCart();
    try {
      const session = await startRestockSession({ clinicId, containerId, userId });
      expect(session?.status).toBe("active");

      await expect(
        finishSession({ clinicId, sessionId: session!.id, userId }),
      ).rejects.toMatchObject({
        name: "RestockServiceError",
        code: "NO_ITEMS_COUNTED",
        status: 400,
      });

      // The refusal must roll the transaction back: the session stays open so
      // the technician can count, or cancel deliberately.
      const [row] = await db
        .select({ status: restockSessions.status, finishedAt: restockSessions.finishedAt })
        .from(restockSessions)
        .where(and(eq(restockSessions.clinicId, clinicId), eq(restockSessions.id, session!.id)))
        .limit(1);
      expect(row?.status).toBe("active");
      expect(row?.finishedAt).toBeNull();
    } finally {
      await purgeClinic(clinicId);
    }
  });

  it("throws a RestockServiceError, so the route maps it to a 400", async () => {
    const { clinicId, userId, containerId } = await seedHospitalCart();
    try {
      const session = await startRestockSession({ clinicId, containerId, userId });
      const err = await finishSession({ clinicId, sessionId: session!.id, userId }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(RestockServiceError);
    } finally {
      await purgeClinic(clinicId);
    }
  });
});
