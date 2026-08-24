/**
 * Phase 10 P1-4 regression: POST /api/code-blue/sessions must reject
 * when an active session already exists for the clinic.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync("server/routes/code-blue.ts", "utf8");
// POST /sessions' handler body was extracted into its own module
// (mechanical file split, the arch-split marker in code-blue.ts); the router file now
// only holds the registration + middleware chain. Append the handler
// file's BODY (from `export const` onward, i.e. excluding its own import
// block) so the order-sensitive assertions below still see the same
// combined text, in the same relative order, they did before the split.
const postSessionsFileSrc = fs.readFileSync(
  path.join("server", "routes", "code-blue", "handlers", "post-sessions.ts"),
  "utf8",
);
const startHandler =
  source.slice(
    source.indexOf('router.post(\n  "/sessions"'),
    source.indexOf('// GET /api/code-blue/sessions/active'),
  ) +
  "\n" +
  postSessionsFileSrc.slice(postSessionsFileSrc.indexOf("export const"));

/**
 * Several code-blue.ts handler bodies were extracted into their own modules
 * (mechanical file split, the arch-split marker in code-blue.ts). `source` alone no
 * longer contains every handler body — concatenate every extracted handler
 * file too, so whole-file assertions below keep seeing the same combined
 * text they did before the split, regardless of which specific handler a
 * given string now lives in.
 */
const handlersDir = path.join("server", "routes", "code-blue", "handlers");
const allHandlersSrc = fs
  .readdirSync(handlersDir)
  .map((f) => fs.readFileSync(path.join(handlersDir, f), "utf8"))
  .join("\n");
const sourceWithHandlers = source + "\n" + allHandlersSrc;

describe("P1-4: Concurrent active CB session guard", () => {
  it("server/routes/code-blue.ts checks for existing active session before insert", () => {
    expect(sourceWithHandlers).toContain("ACTIVE_SESSION_EXISTS");
    expect(sourceWithHandlers).toContain("409");
    const activeCheckIdx = startHandler.indexOf("existingActive");
    const insertIdx = startHandler.indexOf("tx.insert(codeBlueSessions)");
    expect(activeCheckIdx).toBeGreaterThan(0);
    expect(insertIdx).toBeGreaterThan(0);
    expect(activeCheckIdx).toBeLessThan(insertIdx);
  });

  it("active session query uses orderBy desc for deterministic results", () => {
    expect(sourceWithHandlers).toContain("orderBy(desc(codeBlueSessions.startedAt))");
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
