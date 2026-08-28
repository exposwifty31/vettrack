/**
 * Idempotency-Key dedup on POST /api/shift-chat/messages — the server half of
 * RN #148 (broadcast compose).
 *
 * A duplicated broadcast is the worst duplicate in the chat domain: the
 * per-role push idempotency keys derive from the FRESH message.id, so a second
 * insert re-pages every technician — only request-level dedup can stop it.
 * The client sends the header only on broadcast sends; regular messages carry
 * no header and pass through unchanged, which scopes the guard to broadcasts
 * with zero extra code. Replay serves the stored 201 without re-entering the
 * handler, so the push enqueue never fires again.
 *
 * Requires DATABASE_URL and applied migrations (vt_shift_messages,
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
    const messages = await probePool.query<{ regclass: string | null }>(
      `SELECT to_regclass('public.vt_shift_messages') AS regclass`,
    );
    const idem = await probePool.query<{ regclass: string | null }>(
      `SELECT to_regclass('public.vt_idempotency_keys') AS regclass`,
    );
    schemaReady = messages.rows[0]?.regclass != null && idem.rows[0]?.regclass != null;
  } catch (err) {
    let cleanupErr: unknown = null;
    await probePool.end().catch((e: unknown) => {
      cleanupErr = e;
    });
    probePool = null;
    throw new Error(
      `DATABASE_URL is configured but the shift-chat idempotency suite cannot use it: ${
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
      "DATABASE_URL is configured but vt_shift_messages or vt_idempotency_keys is missing. " +
        "Run the migrations, or unset DATABASE_URL to skip this suite." +
        (cleanupErr ? ` (pool cleanup also failed: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)})` : ""),
    );
  }
}

let currentClinicId = "";
let currentUserId = "";

vi.mock("../server/middleware/auth.js", () => ({
  requireAuth: (
    req: {
      authUser?: { id: string; email: string; role: string; name?: string; secondaryRole?: string | null };
      clinicId?: string;
    },
    _res: unknown,
    next: () => void,
  ) => {
    req.authUser = {
      id: currentUserId,
      email: `${currentUserId}@test.local`,
      role: "senior_technician",
      name: "Broadcast Sender",
      secondaryRole: null,
    };
    req.clinicId = currentClinicId;
    next();
  },
  // The broadcast gate reads req.effectiveRole ?? user.role — stamp it the way
  // the real middleware does so the 403 branch is genuinely exercised-able.
  requireEffectiveRole: () => (req: { effectiveRole?: string }, _res: unknown, next: () => void) => {
    req.effectiveRole = "senior_technician";
    next();
  },
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// A real limiter can 429 the concurrency case — passthrough.
vi.mock("../server/middleware/rate-limiters.js", () => ({
  writeLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const enqueuePushNotification = vi.fn().mockResolvedValue(undefined);
vi.mock("../server/lib/queue.js", () => ({
  enqueueNotificationJob: vi.fn().mockResolvedValue(undefined),
  enqueuePushNotification: (...args: unknown[]) => enqueuePushNotification(...args),
}));

vi.mock("../server/lib/push.js", () => ({
  sendPushToUser: vi.fn().mockResolvedValue(undefined),
  sendPushToRole: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../server/lib/audit.js", () => ({
  logAudit: vi.fn(),
  resolveAuditActorRole: () => "senior_technician",
}));

vi.mock("../server/lib/realtime-outbox.js", () => ({
  insertRealtimeDomainEvent: vi.fn(),
}));

vi.mock("../server/lib/shift-chat-presence.js", () => ({
  touchPresence: vi.fn(),
  getPresence: vi.fn().mockResolvedValue([]),
}));

// Open roster window: the message insert only consumes .id (no FK on
// shift_session_id — verified against pg_constraint before writing this).
const openWindowId = randomUUID();
vi.mock("../server/lib/shift-chat-window.js", () => ({
  getCurrentShiftWindow: vi.fn().mockResolvedValue({ id: openWindowId }),
  windowMessagesWhere: vi.fn(() => undefined),
}));


const createdMessageSchema = z.object({ message: z.object({ id: z.string() }) });
const conflictSchema = z.object({ reason: z.string() });

const shiftChatRoutes = (await import("../server/routes/shift-chat.js")).default;

afterAll(async () => {
  if (probePool) await probePool.end();
});

describe.skipIf(!dbReachable || !schemaReady)(
  "POST /api/shift-chat/messages — Idempotency-Key dedup on broadcast",
  () => {
    let server: Server;
    let baseUrl: string;
    const seededClinics: string[] = [];

    beforeEach(() => {
      enqueuePushNotification.mockClear();
      const app = express();
      app.use(express.json());
      app.use("/api/shift-chat", shiftChatRoutes);
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
        await db().query(`DELETE FROM vt_shift_messages WHERE clinic_id = $1`, [clinicId]);
        await db().query(`DELETE FROM vt_users WHERE clinic_id = $1`, [clinicId]);
        await db().query(`DELETE FROM vt_clinics WHERE id = $1`, [clinicId]);
      }
    });

    async function seedClinic() {
      const clinicId = randomUUID();
      const userId = randomUUID();
      currentClinicId = clinicId;
      currentUserId = userId;
      seededClinics.push(clinicId);
      await db().query(`INSERT INTO vt_clinics (id) VALUES ($1)`, [clinicId]);
      await db().query(
        `INSERT INTO vt_users (id, clinic_id, clerk_id, email, name, status)
         VALUES ($1, $2, $3, $4, $5, 'active')`,
        [userId, clinicId, `clerk_${randomUUID()}`, `broadcast_${randomUUID()}@test.local`, "Broadcast Sender"],
      );
      return clinicId;
    }

    const BROADCAST = { body: "סגירת מחלקה", type: "broadcast", broadcastKey: "department_close" };

    function post(body: unknown, key?: string) {
      return fetch(`${baseUrl}/api/shift-chat/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(key ? { "idempotency-key": key } : {}),
        },
        body: JSON.stringify(body),
      });
    }

    async function countMessages(clinicId: string) {
      const { rows } = await db().query<{ count: string }>(
        `SELECT count(*)::text AS count FROM vt_shift_messages WHERE clinic_id = $1`,
        [clinicId],
      );
      return Number(rows[0]?.count ?? 0);
    }

    it("replays the same key as the SAME broadcast — one row, and pushes never re-fire", async () => {
      const clinicId = await seedClinic();
      const key = randomUUID();

      const first = await post(BROADCAST, key);
      expect(first.status).toBe(201);
      const firstBody = createdMessageSchema.parse((await first.json()) as unknown);
      const enqueuedAfterFirst = enqueuePushNotification.mock.calls.length;
      expect(enqueuedAfterFirst).toBeGreaterThan(0);

      const second = await post(BROADCAST, key);
      expect(second.status).toBe(201);
      const secondBody = createdMessageSchema.parse((await second.json()) as unknown);

      expect(secondBody.message.id).toBe(firstBody.message.id);
      expect(await countMessages(clinicId)).toBe(1);
      // The replay is served from the stored row — the handler (and its push
      // enqueue) must not have run a second time.
      expect(enqueuePushNotification.mock.calls.length).toBe(enqueuedAfterFirst);
    });

    it("same key, different body → 409 IDEMPOTENCY_KEY_BODY_MISMATCH, no second row", async () => {
      const clinicId = await seedClinic();
      const key = randomUUID();

      expect((await post(BROADCAST, key)).status).toBe(201);
      const mismatch = await post({ ...BROADCAST, body: "נוסח אחר לגמרי" }, key);
      expect(mismatch.status).toBe(409);
      const body = conflictSchema.parse((await mismatch.json()) as unknown);
      expect(body.reason).toBe("IDEMPOTENCY_KEY_BODY_MISMATCH");
      expect(await countMessages(clinicId)).toBe(1);
    });

    it("no header → no dedup: two posts insert two messages", async () => {
      const clinicId = await seedClinic();
      expect((await post({ body: "hi", type: "regular" })).status).toBe(201);
      expect((await post({ body: "hi", type: "regular" })).status).toBe(201);
      expect(await countMessages(clinicId)).toBe(2);
    });

    it("concurrent same-key broadcasts collapse to one row", async () => {
      const clinicId = await seedClinic();
      const key = randomUUID();
      const [a, b] = await Promise.all([post(BROADCAST, key), post(BROADCAST, key)]);
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(await countMessages(clinicId)).toBe(1);
    });
  },
);
