/**
 * Phase 10 P1-4 regression: POST /api/code-blue/sessions must reject
 * when an active session already exists for the clinic.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";

const source = fs.readFileSync("server/routes/code-blue.ts", "utf8");
const startHandler = source.slice(
  source.indexOf('router.post(\n  "/sessions"'),
  source.indexOf('// GET /api/code-blue/sessions/active'),
);

describe("P1-4: Concurrent active CB session guard", () => {
  it("server/routes/code-blue.ts checks for existing active session before insert", () => {
    expect(source).toContain("ACTIVE_SESSION_EXISTS");
    expect(source).toContain("409");
    const activeCheckIdx = startHandler.indexOf("existingActive");
    const insertIdx = startHandler.indexOf("tx.insert(codeBlueSessions)");
    expect(activeCheckIdx).toBeGreaterThan(0);
    expect(insertIdx).toBeGreaterThan(0);
    expect(activeCheckIdx).toBeLessThan(insertIdx);
  });

  it("active session query uses orderBy desc for deterministic results", () => {
    expect(source).toContain("orderBy(desc(codeBlueSessions.startedAt))");
  });

  it("serializes the active-session check inside the insert transaction", () => {
    const txIdx = startHandler.indexOf("await db.transaction(async (tx)");
    const lockIdx = startHandler.indexOf("pg_advisory_xact_lock", txIdx);
    const activeCheckIdx = startHandler.indexOf("existingActive", txIdx);
    const insertIdx = startHandler.indexOf("tx.insert(codeBlueSessions)", txIdx);

    expect(txIdx).toBeGreaterThan(0);
    expect(lockIdx).toBeGreaterThan(txIdx);
    expect(activeCheckIdx).toBeGreaterThan(lockIdx);
    expect(insertIdx).toBeGreaterThan(activeCheckIdx);
  });
});
