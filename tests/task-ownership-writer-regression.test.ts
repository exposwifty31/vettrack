/**
 * Phase 3 PR 3.2 — writer regression test.
 *
 * The exact-match resolver in `server/lib/task-ownership-resolver.ts` is
 * correct ONLY because the entire codebase has exactly one writer of
 * `metadata.acknowledgedBy` and that writer emits either `vt_users.id` or
 * `vt_users.clerk_id`. If a future PR introduces a new writer that emits a
 * different format (e.g. an email or display name), the resolver will
 * silently misclassify those rows as NO_CANDIDATE.
 *
 * This test reads `server/services/appointments.service.ts` and asserts:
 *   1. exactly one assignment line `metadata.acknowledgedBy = actorIdentifier;`
 *   2. that assignment is preceded by the canonical actorIdentifier formula
 *      `actor.clerkId?.trim() || actor.userId`
 *   3. no other server-side file contains an assignment to
 *      `metadata.acknowledgedBy`
 *
 * If this test fails, the inventory artifact in the Phase 3 plan §7.1 needs
 * to be redone.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const APPOINTMENTS_SERVICE = path.join(REPO_ROOT, "server/services/appointments.service.ts");

describe("acknowledgedBy writer regression — inventory invariant", () => {
  it("appointments.service.ts assigns metadata.acknowledgedBy exactly once", () => {
    const src = fs.readFileSync(APPOINTMENTS_SERVICE, "utf-8");
    // Exclude `===` / `==` (read paths) — only assignments count.
    const matches = src.match(/metadata\.acknowledgedBy\s*=(?!=)/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("the assignment uses the canonical clerkId-or-userId formula", () => {
    const src = fs.readFileSync(APPOINTMENTS_SERVICE, "utf-8");
    expect(src).toMatch(/actor\.clerkId\?\.trim\(\)\s*\|\|\s*actor\.userId/);
    expect(src).toMatch(/metadata\.acknowledgedBy\s*=\s*actorIdentifier/);
  });

  it("no other file under server/ assigns to metadata.acknowledgedBy", () => {
    const serverDir = path.join(REPO_ROOT, "server");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(p);
        } else if (entry.isFile() && /\.(ts|tsx|js)$/.test(entry.name)) {
          if (p === APPOINTMENTS_SERVICE) continue;
          const content = fs.readFileSync(p, "utf-8");
          if (/metadata\.acknowledgedBy\s*=(?!=)/.test(content)) {
            offenders.push(p);
          }
        }
      }
    };
    walk(serverDir);
    expect(offenders).toEqual([]);
  });
});
