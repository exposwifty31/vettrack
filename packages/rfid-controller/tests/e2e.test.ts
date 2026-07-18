import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SyntheticAdapter } from "../src/adapter";
import { loadConfig } from "../src/config";
import { RfidController } from "../src/controller";
import { StaticSecretSource } from "../src/secret-source";
import { HttpSender, type SendOutcome } from "../src/sender";

/**
 * DB-INTEGRATION-CLASS e2e — runs the controller (SyntheticAdapter) against the
 * REAL mounted ingest and asserts on `RfidIngestResult` counts, not just "202".
 *
 * Requires `DATABASE_URL` + applied migrations. It self-skips cleanly when
 * DATABASE_URL is unset (all server db imports are dynamic, inside beforeAll,
 * so nothing connects on skip). It does NOT run migrations and never deletes a
 * clinic or its append-only audit rows — it seeds unique per-run clinic ids and
 * best-effort cleans only the rows it can (equipment/rooms/config/rotation).
 */
const HAS_DB = Boolean(process.env.DATABASE_URL);
const SECRET = "e2e-webhook-secret";
const TAG = "E2E-TAG-0001";
const GW = "E2E-GW-1";

const clinicEnabled = `e2e-rfid-${randomUUID()}`;
const clinicDisabled = `e2e-rfid-off-${randomUUID()}`;
// Module 7 — server-side rotation grace. Dedicated clinic so the [current,
// previous] accepted-secret set never leaks into the single-secret clinics above.
const clinicGrace = `e2e-rfid-grace-${randomUUID()}`;
const GRACE_CURRENT = "e2e-grace-current-secret";
const GRACE_PREVIOUS = "e2e-grace-previous-secret";

let server: Server;
let baseUrl: string;
let teardown: () => Promise<void> = async () => {};

interface IngestResult {
  ok: boolean;
  accepted: number;
  updated: number;
  unchanged: number;
  unknownTag: number;
  unknownGateway: number;
  stale: number;
}

function acceptedResult(outcome: SendOutcome): IngestResult {
  if (outcome.kind !== "accepted") throw new Error(`expected accepted, got ${outcome.kind}`);
  return outcome.result as IngestResult;
}

function controllerFor(clinicId: string, secret = SECRET): RfidController {
  const config = loadConfig({ apiOrigin: baseUrl, clinicId, controllerVersion: "vettrack-rfid/e2e" });
  const sender = new HttpSender({ apiOrigin: baseUrl, clinicId });
  return new RfidController({ config, secretSource: new StaticSecretSource(secret), sender });
}

describe.skipIf(!HAS_DB)("rfid-controller e2e — real ingest (DB-integration-class)", () => {
  beforeAll(async () => {
    const { db, pool, clinics, equipment, rooms, serverConfig, rfidSecretRotations } = await import(
      "../../../server/db.js"
    );
    const { storeCredentials } = await import("../../../server/integrations/credential-manager.js");
    const { eq } = await import("drizzle-orm");
    const rfidRoutes = (await import("../../../server/routes/rfid.js")).default;

    await db.insert(clinics).values({ id: clinicEnabled }).onConflictDoNothing();
    await db.insert(clinics).values({ id: clinicDisabled }).onConflictDoNothing();

    const roomId = randomUUID();
    await db
      .insert(rooms)
      .values({ id: roomId, clinicId: clinicEnabled, name: `E2E Room ${roomId.slice(0, 8)}`, gatewayCode: GW })
      .onConflictDoNothing();
    await db
      .insert(equipment)
      .values({ id: randomUUID(), clinicId: clinicEnabled, name: "E2E Monitor", rfidTagEpc: TAG })
      .onConflictDoNothing();

    const flagKey = `rfid.ingest_enabled.${clinicEnabled}`;
    await db
      .insert(serverConfig)
      .values({ key: flagKey, value: "true" })
      .onConflictDoUpdate({ target: serverConfig.key, set: { value: "true" } });

    // clinicDisabled gets credentials but NO flag → 403 on ingest.
    await storeCredentials(clinicEnabled, "rfid", { webhook_secret: SECRET });
    await storeCredentials(clinicDisabled, "rfid", { webhook_secret: SECRET });

    // clinicGrace: enabled, with a CURRENT + PREVIOUS secret and an OPEN rotation
    // grace window so ingest verifies against [current, previous] (M1.1c).
    const graceFlagKey = `rfid.ingest_enabled.${clinicGrace}`;
    await db.insert(clinics).values({ id: clinicGrace }).onConflictDoNothing();
    await db
      .insert(serverConfig)
      .values({ key: graceFlagKey, value: "true" })
      .onConflictDoUpdate({ target: serverConfig.key, set: { value: "true" } });
    await storeCredentials(clinicGrace, "rfid", {
      webhook_secret: GRACE_CURRENT,
      previous_webhook_secret: GRACE_PREVIOUS,
    });
    await db
      .insert(rfidSecretRotations)
      .values({
        clinicId: clinicGrace,
        id: randomUUID(),
        idempotencyKey: `e2e-grace-${randomUUID()}`,
        status: "grace",
        graceExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        previousRetained: true,
      })
      .onConflictDoNothing();

    const app = express();
    app.use("/api/rfid", express.raw({ type: () => true, limit: "512kb" }), rfidRoutes);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

    teardown = async () => {
      let cleanupError: unknown;
      try {
        await db.delete(equipment).where(eq(equipment.clinicId, clinicEnabled));
        await db.delete(rooms).where(eq(rooms.clinicId, clinicEnabled));
        await db.delete(serverConfig).where(eq(serverConfig.key, flagKey));
        await db.delete(serverConfig).where(eq(serverConfig.key, `${clinicEnabled}:integration:rfid:credentials`));
        await db.delete(serverConfig).where(eq(serverConfig.key, `${clinicDisabled}:integration:rfid:credentials`));
        await db.delete(rfidSecretRotations).where(eq(rfidSecretRotations.clinicId, clinicGrace));
        await db.delete(serverConfig).where(eq(serverConfig.key, graceFlagKey));
        await db.delete(serverConfig).where(eq(serverConfig.key, `${clinicGrace}:integration:rfid:credentials`));
      } catch (error) {
        // Clinic + append-only audit rows persist by design, but an unexpected
        // cleanup failure must surface (and leave the suite red) — not be swallowed.
        cleanupError = error;
        console.error("RFID E2E database cleanup failed", error);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await pool.end();
      }
      if (cleanupError) throw cleanupError;
    };
  }, 30_000);

  afterAll(async () => {
    await teardown();
  });

  it("accepts a signed crossing and the server reports a room change", async () => {
    const summary = await controllerFor(clinicEnabled).run(
      new SyntheticAdapter([{ tagEpc: TAG, gatewayCode: GW, readAt: new Date() }]),
    );
    expect(summary.batches).toBe(1);
    expect(summary.accepted).toBe(1);
    const result = acceptedResult(summary.outcomes[0]);
    expect(result.ok).toBe(true);
    expect(result.accepted).toBeGreaterThanOrEqual(1);
    expect(result.updated).toBeGreaterThanOrEqual(1); // null → room = a room change
  });

  it("stays under the rate limit — a 1000-read flood collapses to ONE batch/POST", async () => {
    const base = Date.now() + 60_000; // strictly newer than the prior read (avoid stale)
    const reads = Array.from({ length: 1000 }, (_, i) => ({
      tagEpc: TAG,
      gatewayCode: GW,
      readAt: new Date(base + i * 5),
    }));
    const summary = await controllerFor(clinicEnabled).run(new SyntheticAdapter(reads));
    expect(summary.batches).toBe(1); // 1000 reads → 1 POST, well under 120/min
    expect(summary.accepted).toBe(1);
    // Already at GW → the server records it unchanged (not a new room change).
    expect(acceptedResult(summary.outcomes[0]).unchanged).toBeGreaterThanOrEqual(1);
  });

  it("unknown tag → still 202 (weak oracle) but RfidIngestResult flags unknownTag", async () => {
    const summary = await controllerFor(clinicEnabled).run(
      new SyntheticAdapter([{ tagEpc: "E2E-NOT-SEEDED", gatewayCode: GW, readAt: new Date(Date.now() + 180_000) }]),
    );
    expect(summary.accepted).toBe(1); // 202 despite the unknown tag — hence "assert 202" is weak
    expect(acceptedResult(summary.outcomes[0]).unknownTag).toBeGreaterThanOrEqual(1);
  });

  it("wrong signature → dropped, never retried (buffer stays empty)", async () => {
    const summary = await controllerFor(clinicEnabled, "WRONG-SECRET").run(
      new SyntheticAdapter([{ tagEpc: TAG, gatewayCode: GW, readAt: new Date(Date.now() + 240_000) }]),
    );
    expect(summary.dropped).toBe(1);
    expect(summary.accepted).toBe(0);
    expect(summary.buffered).toBe(0);
  });

  it("server-side grace: a batch signed with the PREVIOUS secret is accepted during the rotation window", async () => {
    // The controller signs with its ONE current secret and never dual-signs.
    // Here it signs with the PREVIOUS secret; the SERVER accepts it because
    // getRfidVerificationSecrets returns [current, previous] during grace (M1.1c)
    // and the ingest tries each. This is the server-side grace property.
    const prev = await controllerFor(clinicGrace, GRACE_PREVIOUS).run(
      new SyntheticAdapter([{ tagEpc: TAG, gatewayCode: GW, readAt: new Date() }]),
    );
    expect(prev.accepted).toBe(1);
    expect(prev.dropped).toBe(0);

    // The CURRENT secret is accepted as well.
    const cur = await controllerFor(clinicGrace, GRACE_CURRENT).run(
      new SyntheticAdapter([{ tagEpc: TAG, gatewayCode: GW, readAt: new Date(Date.now() + 60_000) }]),
    );
    expect(cur.accepted).toBe(1);
    expect(cur.dropped).toBe(0);

    // A secret that is neither current nor previous → dropped (401), never retried.
    const bogus = await controllerFor(clinicGrace, "e2e-grace-bogus-secret").run(
      new SyntheticAdapter([{ tagEpc: TAG, gatewayCode: GW, readAt: new Date(Date.now() + 120_000) }]),
    );
    expect(bogus.dropped).toBe(1);
    expect(bogus.accepted).toBe(0);
  });

  it("ingest disabled (flag off) → stopped", async () => {
    const summary = await controllerFor(clinicDisabled).run(
      new SyntheticAdapter([{ tagEpc: TAG, gatewayCode: GW, readAt: new Date() }]),
    );
    expect(summary.stopped).toBe(1);
    expect(summary.accepted).toBe(0);
  });
});
