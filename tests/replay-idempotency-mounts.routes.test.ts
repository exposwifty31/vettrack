/**
 * Source pins for the two non-equipment Idempotency-Key mounts.
 *
 * Position is load-bearing: the middleware must run AFTER validateBody so the
 * request hash covers the Zod-defaulted body (support's `severity` default;
 * shift-chat's `isUrgent`/`mentionedUserIds` defaults) — a pre-validation hash
 * would let "same logical request, defaulted vs explicit" collide as a
 * mismatch. The chained regex asserts adjacency, not mere presence, so a
 * refactor that keeps the call but moves it ahead of validation goes red.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf8");
}

describe("replay-idempotency mounts — support + shift-chat", () => {
  it("POST /api/support mounts equipmentReplayIdempotency directly after validateBody", () => {
    const src = source("server/routes/support.ts");
    expect(src).toMatch(
      /router\.post\(\s*"\/",\s*requireAuth,\s*validateBody\(createTicketSchema\),\s*equipmentReplayIdempotency\("POST \/api\/support"\),/,
    );
  });

  it("POST /api/shift-chat/messages mounts equipmentReplayIdempotency directly after validateBody", () => {
    const src = source("server/routes/shift-chat.ts");
    expect(src).toMatch(
      // (?:\s|\/\/[^\n]*)* — whitespace or full-line comments may sit between
      // the two middlewares; anything else (another middleware) breaks the pin.
      /router\.post\(\s*"\/messages",\s*requireAuth,\s*requireEffectiveRole\("technician"\),\s*writeLimiter,\s*validateBody\(postMessageSchema\),(?:\s|\/\/[^\n]*)*equipmentReplayIdempotency\("POST \/api\/shift-chat\/messages"\),/,
    );
  });
});
