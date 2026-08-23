/**
 * RN-Migration #98 — "Failed to save subscription" under concurrent registration.
 *
 * POST /api/push/subscribe (native branch) does delete-then-insert against
 * `ux_vt_push_subscriptions_clinic_token`, a PARTIAL unique index on
 * (clinic_id, token) WHERE token IS NOT NULL (migration 180). Both statements
 * already run inside one `db.transaction`, but a transaction does not by
 * itself serialize two concurrent transactions racing the same key: under
 * READ COMMITTED, a second transaction's INSERT can block on the first's
 * still-uncommitted unique-index entry and then fail with a unique violation
 * once the first commits — the DB itself is doing exactly what it's told,
 * there's just nothing telling the two statements to cooperate instead of
 * collide.
 *
 * This suite fires real concurrent requests at a real Postgres instance
 * through the real Express route — a mocked `db.transaction` (as in
 * push-token-reassignment.test.ts) cannot reproduce the race, because a mock
 * has no real transaction isolation and no real unique-index conflict.
 *
 * Requires DATABASE_URL and migrations (incl. 180) applied.
 * Run: pnpm exec vitest run --config vitest.db-integration.config.ts tests/push-subscription-race.integration.test.ts
 */
import "dotenv/config";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { createServer, type Server } from "node:http";
import express from "express";
import { randomBytes, randomUUID } from "crypto";

// ─── DB probe ────────────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL ?? "";
let probePool: Pool | null = null;
let dbReachable = false;

if (DATABASE_URL) {
  probePool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000, max: 10 });
  try {
    await probePool.query("SELECT 1");
    const { rows } = await probePool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'vt_push_subscriptions' AND indexname = 'ux_vt_push_subscriptions_clinic_token'`,
    );
    dbReachable = rows.length === 1;
  } catch {
    dbReachable = false;
  }
}

// ─── Mocks (hoisted before dynamic imports) ─────────────────────────────────

let currentClinicId = "";
let currentUserId = "";

vi.mock("../server/middleware/auth.js", () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.authUser = { id: currentUserId, email: "race@test.local", role: "vet" };
    req.clinicId = currentClinicId;
    next();
  },
}));

vi.mock("../server/middleware/rate-limiters.js", () => ({
  authSensitiveLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  pushTestLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../server/lib/push.js", () => ({
  sendPushToUser: vi.fn(),
  getVapidPublicKey: vi.fn(),
  isVapidReady: () => false,
  isPushReady: () => false,
  whenPushInitialized: vi.fn(() => Promise.resolve()),
}));

vi.mock("../server/lib/audit.js", () => ({
  logAudit: vi.fn(),
  resolveAuditActorRole: () => "vet",
}));

// ─── Route import (after mocks are hoisted) ─────────────────────────────────

const pushRoutes = (await import("../server/routes/push.js")).default;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/push", pushRoutes);
  return app;
}

let server: Server;
let baseUrl: string;

async function api(
  path: string,
  method: "GET" | "POST" | "DELETE" | "PATCH",
  body: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  if (text) {
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = { raw: text };
    }
  }
  return { status: res.status, json };
}

async function seedClinic(clinicId: string) {
  await probePool!.query(`INSERT INTO vt_clinics (id) VALUES ($1) ON CONFLICT DO NOTHING`, [clinicId]);
}

async function seedUser(userId: string, clinicId: string) {
  await probePool!.query(
    `INSERT INTO vt_users (id, clinic_id, clerk_id, email, name, role, status)
     VALUES ($1, $2, $3, $4, $5, 'vet', 'active')
     ON CONFLICT DO NOTHING`,
    [userId, clinicId, `clerk_${randomUUID()}`, `u_${randomUUID()}@race.local`, "Race Test User"],
  );
}

function iosToken(): string {
  return randomBytes(32).toString("hex"); // 64 hex chars — matches IOS_TOKEN_RE
}

describe.skipIf(!dbReachable)("push subscription race (RN #98)", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required for integration tests");

    const app = buildApp();
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    if (probePool) await probePool.end();
  });

  let clinicId: string;
  let userId: string;

  beforeEach(async () => {
    clinicId = randomUUID();
    userId = randomUUID();
    currentClinicId = clinicId;
    currentUserId = userId;
    await seedClinic(clinicId);
    await seedUser(userId, clinicId);
  });

  afterEach(async () => {
    await probePool!.query(`DELETE FROM vt_push_subscriptions WHERE clinic_id = $1`, [clinicId]);
    await probePool!.query(`DELETE FROM vt_users WHERE clinic_id = $1`, [clinicId]);
    await probePool!.query(`DELETE FROM vt_clinics WHERE id = $1`, [clinicId]);
  });

  it("5 concurrent subscribes with the SAME (clinicId, token) all succeed, exactly one row survives", async () => {
    const token = iosToken();
    const body = { platform: "ios", token };

    const results = await Promise.all(
      Array.from({ length: 5 }, () => api("/api/push/subscribe", "POST", body)),
    );

    const statuses = results.map((r) => r.status);
    // This is the assertion that must go red before the fix: delete-then-insert
    // races itself under concurrency and some subset comes back 500
    // PUSH_SUBSCRIBE_SAVE_FAILED, matching the observed 200 500 500 200 500 shape.
    expect(statuses.every((s) => s === 200)).toBe(true);

    const { rows } = await probePool!.query(
      `SELECT id, user_id FROM vt_push_subscriptions WHERE clinic_id = $1 AND token = $2`,
      [clinicId, token],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(userId);
  });

  it("5 concurrent subscribes with DIFFERENT tokens all succeed independently (control case)", async () => {
    const bodies = Array.from({ length: 5 }, () => ({ platform: "ios" as const, token: iosToken() }));

    const results = await Promise.all(bodies.map((b) => api("/api/push/subscribe", "POST", b)));

    expect(results.map((r) => r.status).every((s) => s === 200)).toBe(true);

    const { rows } = await probePool!.query(
      `SELECT token FROM vt_push_subscriptions WHERE clinic_id = $1`,
      [clinicId],
    );
    expect(rows).toHaveLength(5);
  });
});
