/**
 * Idempotency-Key dedup on POST /api/support — the server half of RN #147.
 *
 * The RN client mints a caller-owned key per logical submission and replays it
 * across retries; without server dedup a retried submit files the same ticket
 * twice and pages every admin twice. Reuses equipmentReplayIdempotency — the
 * factory was always generic (endpoint label, clinic+user scoped storage,
 * body-hash mismatch 409, 2xx-only persist, per-key in-process serialization).
 *
 * Requires DATABASE_URL and applied migrations (vt_support_tickets,
 * vt_idempotency_keys). Harness cloned from equipment-quick-scan-idempotency.
 */
import "dotenv/config";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { createServer, type Server } from "node:http";
import express from "express";
import { randomUUID } from "crypto";
import { z } from "zod";

const DATABASE_URL = process.env.DATABASE_URL ?? "";

let probePool: Pool | null = null;

function db(): Pool {
  if (!probePool) throw new Error("probePool is not initialised — this suite must not have run");
  return probePool;
}
let dbReachable = false;
let schemaReady = false;

if (DATABASE_URL) {
  probePool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 1500, max: 1 });
  try {
    await probePool.query("SELECT 1");
    dbReachable = true;
    const tickets = await probePool.query<{ regclass: string | null }>(
      `SELECT to_regclass('public.vt_support_tickets') AS regclass`,
    );
    const idem = await probePool.query<{ regclass: string | null }>(
      `SELECT to_regclass('public.vt_idempotency_keys') AS regclass`,
    );
    schemaReady = tickets.rows[0]?.regclass != null && idem.rows[0]?.regclass != null;
  } catch (err) {
    let cleanupErr: unknown = null;
    await probePool.end().catch((e: unknown) => {
      cleanupErr = e;
    });
    probePool = null;
    throw new Error(
      `DATABASE_URL is configured but the support idempotency suite cannot use it: ${
        err instanceof Error ? err.message : String(err)
      }${cleanupErr ? `; pool cleanup also failed: ${String(cleanupErr)}` : ""}`,
    );
  }
  if (!schemaReady) {
    let cleanupErr: unknown = null;
    await probePool.end().catch((e: unknown) => {
      cleanupErr = e;
    });
    probePool = null;
    throw new Error(
      "DATABASE_URL is configured but vt_support_tickets or vt_idempotency_keys is missing. " +
        "Run the migrations, or unset DATABASE_URL to skip this suite." +
        (cleanupErr ? ` (pool cleanup also failed: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)})` : ""),
    );
  }
}

let currentClinicId = "";
let currentUserId = "";

vi.mock("../server/middleware/auth.js", () => ({
  requireAuth: (
    req: { authUser?: { id: string; email: string; role: string }; clinicId?: string },
    _res: unknown,
    next: () => void,
  ) => {
    req.authUser = { id: currentUserId, email: `${currentUserId}@test.local`, role: "technician" };
    req.clinicId = currentClinicId;
    next();
  },
  requireEffectiveRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../server/lib/push.js", () => ({
  sendPushToAll: vi.fn().mockResolvedValue(undefined),
}));


const createdTicketSchema = z.object({ id: z.string() });
const conflictSchema = z.object({ reason: z.string() });

const supportRoutes = (await import("../server/routes/support.js")).default;

afterAll(async () => {
  if (probePool) await probePool.end();
});

describe.skipIf(!dbReachable || !schemaReady)("POST /api/support — Idempotency-Key dedup", () => {
  let server: Server;
  let baseUrl: string;
  const seededClinics: string[] = [];

  beforeEach(() => {
    const app = express();
    app.use(express.json());
    app.use("/api/support", supportRoutes);
    server = createServer(app);
    return new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address();
        baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
        resolve();
      });
    });
  });

  afterEach(() => {
    return new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  afterAll(async () => {
    for (const clinicId of seededClinics) {
      await db().query(`DELETE FROM vt_idempotency_keys WHERE clinic_id = $1`, [clinicId]);
      await db().query(`DELETE FROM vt_support_tickets WHERE clinic_id = $1`, [clinicId]);
      await db().query(`DELETE FROM vt_clinics WHERE id = $1`, [clinicId]);
    }
  });

  async function seedClinic() {
    const clinicId = randomUUID();
    currentClinicId = clinicId;
    currentUserId = randomUUID();
    seededClinics.push(clinicId);
    await db().query(`INSERT INTO vt_clinics (id) VALUES ($1)`, [clinicId]);
    return clinicId;
  }

  function post(body: unknown, key?: string) {
    return fetch(`${baseUrl}/api/support`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(key ? { "idempotency-key": key } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  async function countTickets(clinicId: string) {
    const { rows } = await db().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM vt_support_tickets WHERE clinic_id = $1`,
      [clinicId],
    );
    return Number(rows[0]?.count ?? 0);
  }

  const TICKET = { title: "NFC reader dead", description: "Scanner will not read tags", severity: "high" };

  it("replays the same key as the SAME ticket — one row, identical 201", async () => {
    const clinicId = await seedClinic();
    const key = randomUUID();

    const first = await post(TICKET, key);
    expect(first.status).toBe(201);
    const firstBody = createdTicketSchema.parse((await first.json()) as unknown);

    const second = await post(TICKET, key);
    expect(second.status).toBe(201);
    const secondBody = createdTicketSchema.parse((await second.json()) as unknown);

    expect(secondBody.id).toBe(firstBody.id);
    expect(await countTickets(clinicId)).toBe(1);
  });

  it("same key, different body → 409 IDEMPOTENCY_KEY_BODY_MISMATCH, no second row", async () => {
    const clinicId = await seedClinic();
    const key = randomUUID();

    expect((await post(TICKET, key)).status).toBe(201);
    const mismatch = await post({ ...TICKET, title: "Different title" }, key);
    expect(mismatch.status).toBe(409);
    const body = conflictSchema.parse((await mismatch.json()) as unknown);
    expect(body.reason).toBe("IDEMPOTENCY_KEY_BODY_MISMATCH");
    expect(await countTickets(clinicId)).toBe(1);
  });

  it("no header → no dedup: two submissions file two tickets", async () => {
    const clinicId = await seedClinic();
    expect((await post(TICKET)).status).toBe(201);
    expect((await post(TICKET)).status).toBe(201);
    expect(await countTickets(clinicId)).toBe(2);
  });

  it("concurrent same-key submissions collapse to one row", async () => {
    const clinicId = await seedClinic();
    const key = randomUUID();
    const [a, b] = await Promise.all([post(TICKET, key), post(TICKET, key)]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(await countTickets(clinicId)).toBe(1);
  });
});
