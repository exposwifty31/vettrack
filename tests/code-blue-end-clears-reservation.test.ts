/**
 * R-CBF-1 (pre-PR panel #1) — the PATCH /sessions/:id/end handler MUST clear the
 * session's advisory cart soft-reserve INSIDE the end transaction.
 *
 * The one-tap start reserves a crash cart via `vt_equipment.reservedForSessionId`
 * (server/lib/code-blue-soft-reserve.ts), and the nearest-ready-cart resolver
 * excludes any cart whose `reservedForSessionId IS NOT NULL`. If the reservation
 * is never cleared on end, every ended Code Blue permanently removes its cart
 * from the ready pool — after a handful of events the headline auto-link silently
 * degrades to `noCartAvailable` forever, with no recovery path.
 *
 * The `/end` route is the ONLY production path that transitions a session to
 * "ended" (the reconciliation scanner only detects already-ended sessions), so
 * clearing must be wired here, transaction-scoped, so it commits/rolls back atomically
 * with the session-end write. The reserve/clear behaviour itself is unit-tested in
 * code-blue-soft-reserve.test.ts + code-blue-one-tap-orchestration.test.ts; this
 * test pins the production route wiring that composes the primitive.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("R-CBF-1 · /end clears the cart soft-reserve (panel #1)", () => {
  const src = readFileSync("server/routes/code-blue.ts", "utf8");
  const endHandler = src.slice(src.indexOf('router.patch("/sessions/:id/end"'));
  const txStart = endHandler.indexOf("db.transaction(async (tx)");
  // The end transaction block: from `db.transaction(...)` up to the archive step
  // that follows it. The reservation clear must live inside this window.
  const txBlock = endHandler.slice(txStart, endHandler.indexOf("// Archive to vt_code_blue_events"));

  it("clears the session's reservation inside the end transaction", () => {
    expect(txStart).toBeGreaterThan(-1);
    expect(txBlock).toContain("clearReservationForSession");
  });

  it("uses a transaction-scoped reservation store (composed in the end txn, not a separate connection)", () => {
    expect(txBlock).toMatch(/new DrizzleCartReservationStore\(\s*tx\s*\)/);
  });
});
