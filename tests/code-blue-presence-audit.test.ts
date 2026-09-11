/**
 * #250 — the presence heartbeat (PATCH /code-blue/sessions/:id/presence, every
 * 10 s per participant) wrote one audit row per beat. vt_code_blue_presence is
 * the liveness source of truth (PK session_id+user_id, last_seen_at upserted on
 * every beat), so the audit trail only needs the JOIN: one row when a participant
 * first appears in a session. The presence upsert itself must still run on every
 * beat — that is the clinical invariant, not the audit row.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const logAudit = vi.fn();
vi.mock("../server/lib/audit.js", () => ({
  logAudit: (...args: unknown[]) => logAudit(...args),
  resolveAuditActorRole: () => "vet",
}));

// One fluent object for both the session lookup and the presence upsert. The
// root call (select / insert) sets what awaiting the chain resolves to; the
// upsert resolves `inserted` true on the first beat of a (session,user) pair and
// false afterwards, which is what `RETURNING (xmax = 0)` yields in Postgres.
let mode: "select" | "insert" = "select";
const seen = new Set<string>();
let insertCalls = 0;
let lastValues: { sessionId: string; userId: string } | null = null;
// When set, awaiting the presence upsert rejects with it (the failure path).
let upsertError: Error | null = null;
const fluent: Record<string, unknown> = {};
for (const m of ["from", "where", "limit", "onConflictDoUpdate", "returning"]) {
  fluent[m] = () => fluent;
}
fluent.values = (v: { sessionId: string; userId: string }) => {
  lastValues = v;
  return fluent;
};
(fluent as { then?: unknown }).then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
  if (mode === "select") return resolve([{ id: "s1" }]);
  insertCalls += 1;
  if (upsertError && reject) return reject(upsertError);
  const key = `${lastValues!.sessionId}:${lastValues!.userId}`;
  const inserted = !seen.has(key);
  seen.add(key);
  return resolve([{ inserted }]);
};

vi.mock("../server/db.js", () => ({
  db: {
    select: () => {
      mode = "select";
      return fluent;
    },
    insert: () => {
      mode = "insert";
      return fluent;
    },
  },
  codeBlueSessions: { id: "codeBlueSessions.id", clinicId: "codeBlueSessions.clinicId" },
  codeBluePresence: { sessionId: "codeBluePresence.sessionId", userId: "codeBluePresence.userId" },
}));

import { patchSessionsIdPresenceHandler } from "../server/routes/code-blue/handlers/patch-sessions-id-presence.js";

// Test doubles for the handler's Express surface. The handler reads exactly
// req.params.id, req.headers["x-request-id"], req.clinicId and req.authUser
// (set by requireAuth in production), and writes through res.status().json();
// resolveRequestId() also touches res.setHeader/getHeader. Nothing else on
// Request/Response is reached, so the partial objects are cast to the full
// types once, here, rather than at every call site.
type Captured = { status: number; body: unknown };
function makeReq(userId: string): Request {
  return {
    params: { id: "s1" },
    headers: {},
    clinicId: "clinic-a",
    authUser: { id: userId, email: `${userId}@clinic.test`, name: userId, role: "vet" },
  } as unknown as Request;
}
function makeRes(): { res: Response; captured: Captured } {
  const captured: Captured = { status: 200, body: null };
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(payload: unknown) {
      captured.body = payload;
      return this;
    },
    setHeader() {},
    getHeader() {
      return undefined;
    },
  } as unknown as Response;
  return { res, captured };
}
async function beat(userId: string): Promise<Captured> {
  const { res, captured } = makeRes();
  await patchSessionsIdPresenceHandler(makeReq(userId), res, () => {});
  return captured;
}

describe("#250 — code blue presence audit", () => {
  beforeEach(() => {
    logAudit.mockClear();
    seen.clear();
    insertCalls = 0;
    upsertError = null;
  });

  it("audits a participant once, on the first beat, as code_blue_presence_joined", async () => {
    await beat("u1");
    await beat("u1");
    await beat("u1");
    expect(logAudit).toHaveBeenCalledTimes(1);
    expect(logAudit.mock.calls[0][0]).toMatchObject({
      actionType: "code_blue_presence_joined",
      clinicId: "clinic-a",
      performedBy: "u1",
      targetId: "s1",
      targetType: "code_blue_session",
    });
  });

  it("audits each distinct participant's join, and nothing for their later beats", async () => {
    await beat("u1");
    await beat("u2");
    await beat("u1");
    await beat("u2");
    expect(logAudit).toHaveBeenCalledTimes(2);
    expect(logAudit.mock.calls.map((c) => (c[0] as { performedBy: string }).performedBy)).toEqual(["u1", "u2"]);
  });

  it("still upserts presence on every beat (the liveness write is never skipped)", async () => {
    await beat("u1");
    await beat("u1");
    expect(insertCalls).toBe(2);
  });

  it("answers 500 PRESENCE_FAILED and writes no audit row when the presence upsert rejects", async () => {
    upsertError = new Error("connection reset");
    const captured = await beat("u1");
    expect(captured.status).toBe(500);
    expect(captured.body).toMatchObject({ code: "INTERNAL_ERROR", reason: "PRESENCE_FAILED" });
    expect(logAudit).not.toHaveBeenCalled();
  });
});
