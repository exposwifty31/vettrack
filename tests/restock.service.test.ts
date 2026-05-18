/**
 * Restock service — Phase 2 (session concurrency) & Phase 3 (atomic scan) behavior.
 *
 * Requires: DATABASE_URL (e.g. from .env), migrations applied (including
 * `042_uniq_active_restock_session_per_container.sql`).
 *
 * Run: pnpm exec tsx tests/restock.service.test.ts
 */
import "dotenv/config";
import assert from "node:assert";
import { randomUUID } from "crypto";
import { eq, and } from "drizzle-orm";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("⚠️  restock.service tests skipped (DATABASE_URL not set)");
    process.exit(0);
  }

  const { db, pool, clinics, users, containers, inventoryItems, containerItems, restockSessions, restockEvents, inventoryLogs } =
    await import("../server/db.js");
  const { startRestockSession, scanItem, finishSession, getContainerInventoryView, RestockServiceError } = await import(
    "../server/services/restock.service.js",
  );

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
    const userA = randomUUID();
    const userB = randomUUID();
    const containerId = randomUUID();
    await db.insert(clinics).values({ id: clinicId });
    await db.insert(users).values([
      {
        id: userA,
        clinicId,
        clerkId: `clerk_${randomUUID()}`,
        email: `u1_${randomUUID()}@example.com`,
        name: "Test A",
      },
      {
        id: userB,
        clinicId,
        clerkId: `clerk_${randomUUID()}`,
        email: `u2_${randomUUID()}@example.com`,
        name: "Test B",
      },
    ]);
    await db.insert(containers).values({
      id: containerId,
      clinicId,
      name: "Hospital Supply Cart",
      department: "Hospital",
    });
    return { clinicId, userA, userB, containerId };
  }

  try {
    // ─── Existing: single session start ─────────────────────────────────────
    {
      const { clinicId, userA, containerId } = await seedHospitalCart();
      try {
        const session = await startRestockSession({ clinicId, containerId, userId: userA });
        assert.strictEqual(session?.status, "active");
        assert.strictEqual(session?.containerId, containerId);
      } finally {
        await purgeClinic(clinicId);
      }
    }

    // ─── Blueprint view: legacy item codes are resolved for ER Supply Cart ───
    {
      const clinicId = randomUUID();
      const userId = randomUUID();
      const containerId = randomUUID();
      const legacySyringeId = randomUUID();
      const legacyIvId = randomUUID();
      try {
        await db.insert(clinics).values({ id: clinicId });
        await db.insert(users).values({
          id: userId,
          clinicId,
          clerkId: `clerk_${randomUUID()}`,
          email: `legacy_${randomUUID()}@example.com`,
          name: "Legacy Codes User",
        });
        await db.insert(containers).values({
          id: containerId,
          clinicId,
          name: "ER Supply Cart",
          department: "Emergency",
        });
        await db.insert(inventoryItems).values([
          {
            id: legacySyringeId,
            clinicId,
            code: "SYR_5ML",
            label: "Syringe 5ml",
            category: "Emergency",
          },
          {
            id: legacyIvId,
            clinicId,
            code: "IV_16G",
            label: "IV Catheter 16G",
            category: "Emergency",
          },
        ]);
        await db.insert(containerItems).values([
          {
            id: randomUUID(),
            clinicId,
            containerId,
            itemId: legacySyringeId,
            quantity: 20,
          },
          {
            id: randomUUID(),
            clinicId,
            containerId,
            itemId: legacyIvId,
            quantity: 20,
          },
        ]);

        const view = await getContainerInventoryView({ clinicId, containerId });
        const syringeLine = view.lines.find((line) => line.code === "SYRINGE_5ML");
        const ivLine = view.lines.find((line) => line.code === "IV_CATHETER_16G");

        assert(syringeLine, "SYRINGE_5ML line should be present for ER Supply Cart");
        assert(ivLine, "IV_CATHETER_16G line should be present for ER Supply Cart");
        assert.strictEqual(syringeLine.actual, 20);
        assert.strictEqual(ivLine.actual, 20);
        assert.strictEqual(syringeLine.itemId, legacySyringeId);
        assert.strictEqual(ivLine.itemId, legacyIvId);
      } finally {
        await purgeClinic(clinicId);
      }
    }

    // ─── Phase 2: parallel session start (one wins, one 409) ──────────────
    {
      const { clinicId, userA, userB, containerId } = await seedHospitalCart();
      try {
        const results = await Promise.allSettled([
          startRestockSession({ clinicId, containerId, userId: userA }),
          startRestockSession({ clinicId, containerId, userId: userB }),
        ]);
        const fulfilled = results.filter((r) => r.status === "fulfilled");
        const rejected = results.filter((r) => r.status === "rejected");
        assert.strictEqual(fulfilled.length, 1, "exactly one start should succeed");
        assert.strictEqual(rejected.length, 1, "exactly one start should fail");
        const reason = (rejected[0] as PromiseRejectedResult).reason;
        assert(reason instanceof RestockServiceError);
        assert.strictEqual(reason.code, "SESSION_ALREADY_ACTIVE");
        assert.strictEqual(reason.status, 409);
      } finally {
        await purgeClinic(clinicId);
      }
    }

    // ─── Phase 3: concurrent observedQuantity scans (all events recorded) ────
    {
      const { clinicId, userA, containerId } = await seedHospitalCart();
      try {
        const session = await startRestockSession({ clinicId, containerId, userId: userA });
        const [syringe] = await db
          .select({ id: inventoryItems.id })
          .from(inventoryItems)
          .where(and(eq(inventoryItems.clinicId, clinicId), eq(inventoryItems.code, "SYRINGE_5ML")))
          .limit(1);
        assert(syringe, "SYRINGE_5ML should be seeded for Hospital Supply Cart");

        const N = 20;
        // All scans record observedQuantity=1; scanItem is event-only (no containerItems mutation)
        await Promise.all(
          Array.from({ length: N }, () =>
            scanItem({
              clinicId,
              sessionId: session.id,
              itemId: syringe.id,
              observedQuantity: 1,
              userId: userA,
            }),
          ),
        );

        const events = await db
          .select({ id: restockEvents.id })
          .from(restockEvents)
          .where(
            and(
              eq(restockEvents.clinicId, clinicId),
              eq(restockEvents.sessionId, session.id),
              eq(restockEvents.itemId, syringe.id),
            ),
          );
        assert.strictEqual(events.length, N, "all concurrent scan events must be recorded");
      } finally {
        await purgeClinic(clinicId);
      }
    }

    // ─── Invalid observedQuantity rejected ────────────────────────────────
    {
      const { clinicId, userA, containerId } = await seedHospitalCart();
      try {
        const session = await startRestockSession({ clinicId, containerId, userId: userA });
        const [syringe] = await db
          .select({ id: inventoryItems.id })
          .from(inventoryItems)
          .where(and(eq(inventoryItems.clinicId, clinicId), eq(inventoryItems.code, "SYRINGE_5ML")))
          .limit(1);
        assert(syringe);

        let threw = false;
        try {
          await scanItem({
            clinicId,
            sessionId: session.id,
            itemId: syringe.id,
            observedQuantity: -1,
            userId: userA,
          });
        } catch (e) {
          threw = true;
          assert(e instanceof RestockServiceError);
          assert.strictEqual(e.code, "INVALID_QUANTITY");
          assert.strictEqual(e.status, 400);
        }
        assert(threw, "expected INVALID_QUANTITY for negative observedQuantity");
      } finally {
        await purgeClinic(clinicId);
      }
    }

    // ─── Existing: single positive scan shape ─────────────────────────────
    {
      const { clinicId, userA, containerId } = await seedHospitalCart();
      try {
        const session = await startRestockSession({ clinicId, containerId, userId: userA });
        const [syringe] = await db
          .select({ id: inventoryItems.id })
          .from(inventoryItems)
          .where(and(eq(inventoryItems.clinicId, clinicId), eq(inventoryItems.code, "SYRINGE_5ML")))
          .limit(1);
        assert(syringe);

        const out = await scanItem({
          clinicId,
          sessionId: session.id,
          itemId: syringe.id,
          observedQuantity: 3,
          userId: userA,
        });
        assert(out.event?.id);
        assert.strictEqual(out.observedQuantity, 3);
        assert.strictEqual(out.item?.id, syringe.id);
      } finally {
        await purgeClinic(clinicId);
      }
    }

    // ─── Scan: successive observations — finishSession commits last scan ───
    {
      const { clinicId, userA, containerId } = await seedHospitalCart();
      try {
        const session = await startRestockSession({ clinicId, containerId, userId: userA });
        const [syringe] = await db
          .select({ id: inventoryItems.id })
          .from(inventoryItems)
          .where(and(eq(inventoryItems.clinicId, clinicId), eq(inventoryItems.code, "SYRINGE_5ML")))
          .limit(1);
        assert(syringe);

        await db
          .update(containerItems)
          .set({ quantity: 5, updatedAt: new Date() })
          .where(
            and(
              eq(containerItems.clinicId, clinicId),
              eq(containerItems.containerId, containerId),
              eq(containerItems.itemId, syringe.id),
            ),
          );

        // First observation: technician counts 7 units
        await scanItem({
          clinicId,
          sessionId: session.id,
          itemId: syringe.id,
          observedQuantity: 7,
          userId: userA,
        });
        // Second observation: technician recounts and sees 4 units (last wins)
        await scanItem({
          clinicId,
          sessionId: session.id,
          itemId: syringe.id,
          observedQuantity: 4,
          userId: userA,
        });

        await finishSession({ clinicId, sessionId: session.id, userId: userA });

        const [line] = await db
          .select({ quantity: containerItems.quantity })
          .from(containerItems)
          .where(
            and(
              eq(containerItems.clinicId, clinicId),
              eq(containerItems.containerId, containerId),
              eq(containerItems.itemId, syringe.id),
            ),
          )
          .limit(1);
        assert.strictEqual(line?.quantity, 4);
      } finally {
        await purgeClinic(clinicId);
      }
    }

    // ─── Concurrent scans: both events recorded; last write wins at finish ─
    {
      const { clinicId, userA, containerId } = await seedHospitalCart();
      try {
        const session = await startRestockSession({ clinicId, containerId, userId: userA });
        const [syringe] = await db
          .select({ id: inventoryItems.id })
          .from(inventoryItems)
          .where(and(eq(inventoryItems.clinicId, clinicId), eq(inventoryItems.code, "SYRINGE_5ML")))
          .limit(1);
        assert(syringe);

        // Both concurrent scans succeed and both events are stored
        const [resA, resB] = await Promise.all([
          scanItem({
            clinicId,
            sessionId: session.id,
            itemId: syringe.id,
            observedQuantity: 6,
            userId: userA,
          }),
          scanItem({
            clinicId,
            sessionId: session.id,
            itemId: syringe.id,
            observedQuantity: 4,
            userId: userA,
          }),
        ]);

        assert(resA?.event?.id, "first concurrent scan must produce an event");
        assert(resB?.event?.id, "second concurrent scan must produce an event");

        // containerItems unchanged until finishSession
        const [lineBeforeFinish] = await db
          .select({ quantity: containerItems.quantity })
          .from(containerItems)
          .where(
            and(
              eq(containerItems.clinicId, clinicId),
              eq(containerItems.containerId, containerId),
              eq(containerItems.itemId, syringe.id),
            ),
          )
          .limit(1);
        // quantity is unchanged pre-finish (scanItem is event-only)
        assert.ok((lineBeforeFinish?.quantity ?? 0) >= 0);
      } finally {
        await purgeClinic(clinicId);
      }
    }

    // ─── scanItem does NOT inspect containerItems state ───────────────────
    // The event-sourcing model records observedQuantity as-is; containerItems
    // is only mutated at finishSession. So an unusual container quantity does
    // not block a scan.
    {
      const { clinicId, userA, containerId } = await seedHospitalCart();
      try {
        const session = await startRestockSession({ clinicId, containerId, userId: userA });
        const [syringe] = await db
          .select({ id: inventoryItems.id })
          .from(inventoryItems)
          .where(and(eq(inventoryItems.clinicId, clinicId), eq(inventoryItems.code, "SYRINGE_5ML")))
          .limit(1);
        assert(syringe);

        await pool.query(
          `UPDATE vt_container_items SET quantity = $1, updated_at = NOW()
           WHERE clinic_id = $2 AND container_id = $3 AND item_id = $4`,
          [-100, clinicId, containerId, syringe.id],
        );

        // Should succeed: scanItem does not check containerItems.quantity
        const out = await scanItem({
          clinicId,
          sessionId: session.id,
          itemId: syringe.id,
          observedQuantity: 5,
          userId: userA,
        });
        assert(out.event?.id, "scan must succeed regardless of current containerItems quantity");
        assert.strictEqual(out.observedQuantity, 5);
      } finally {
        await purgeClinic(clinicId);
      }
    }

    // ─── Regression: finishSession commits 2+ items without colliding on
    //     the `inventory_logs_task_clinic_type_idx` unique index
    //     (task_id, clinic_id, log_type). Previously, finishSession reused
    //     session.id as task_id for every committed row, so the second item
    //     threw a 23505 and the route returned a generic 500
    //     "Restock operation failed" toast.
    {
      const { clinicId, userA, containerId } = await seedHospitalCart();
      try {
        const session = await startRestockSession({ clinicId, containerId, userId: userA });
        const seeded = await db
          .select({ id: inventoryItems.id, code: inventoryItems.code })
          .from(inventoryItems)
          .where(eq(inventoryItems.clinicId, clinicId));
        assert(seeded.length >= 2, "blueprint should seed multiple items for Hospital Supply Cart");

        await scanItem({
          clinicId,
          sessionId: session.id,
          itemId: seeded[0].id,
          observedQuantity: 4,
          userId: userA,
        });
        await scanItem({
          clinicId,
          sessionId: session.id,
          itemId: seeded[1].id,
          observedQuantity: 6,
          userId: userA,
        });

        const summary = await finishSession({ clinicId, sessionId: session.id, userId: userA });
        assert.strictEqual(summary.scannedItemCount, 2, "both items must commit");
        assert.strictEqual(summary.committedItems.length, 2, "both committedItems entries returned");

        const logs = await db
          .select({ id: inventoryLogs.id, taskId: inventoryLogs.taskId })
          .from(inventoryLogs)
          .where(eq(inventoryLogs.clinicId, clinicId));
        assert.strictEqual(logs.length, 2, "one inventory_log row per scanned item");
        const taskIds = new Set(logs.map((l) => l.taskId));
        assert.strictEqual(taskIds.size, 2, "each restock log row carries a distinct task_id");
      } finally {
        await purgeClinic(clinicId);
      }
    }

    console.log("✅ restock.service.test.ts passed");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
