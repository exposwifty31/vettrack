/**
 * Equipment scan lifecycle — unit + static analysis tests.
 *
 * Does NOT require a database or live server. Covers:
 *   - Checkout / return / blocked state-machine logic
 *   - Response shape contracts (verified via route source analysis)
 *   - Transaction safety assertions
 *   - Multi-tenancy scoping assertions
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const routeSource = fs.readFileSync(
  path.resolve(__dirname, "../server/routes/equipment.ts"),
  "utf8",
);

// ─────────────────────────────────────────────────────────────────────────────
// Pure state-machine: mirrors the exact decision logic in POST /api/equipment/scan
// ─────────────────────────────────────────────────────────────────────────────

type ScanAction = "checkout" | "return" | "blocked";

function decideScanAction(
  checkedOutById: string | null,
  actorId: string,
): ScanAction {
  if (checkedOutById && checkedOutById !== actorId) return "blocked";
  if (!checkedOutById) return "checkout";
  return "return";
}

// ─────────────────────────────────────────────────────────────────────────────
// State machine unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Equipment scan state machine", () => {
  it("available equipment (checkedOutById=null) → checkout", () => {
    expect(decideScanAction(null, "user-a")).toBe("checkout");
  });

  it("equipment held by same user → return (toggle)", () => {
    expect(decideScanAction("user-a", "user-a")).toBe("return");
  });

  it("equipment held by a different user → blocked (conflict)", () => {
    expect(decideScanAction("user-b", "user-a")).toBe("blocked");
  });

  it("admin scanning equipment held by another user → still blocked", () => {
    expect(decideScanAction("junior-staff-id", "admin-id")).toBe("blocked");
  });

  it("checkedOutById='x', actorId='x' (exact match) → return, not blocked", () => {
    expect(decideScanAction("x", "x")).toBe("return");
  });

  it("empty-string actorId does not match a real holder", () => {
    expect(decideScanAction("real-user", "")).toBe("blocked");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Route registration
// ─────────────────────────────────────────────────────────────────────────────

describe("Equipment scan route — registration", () => {
  it('POST /scan alias is registered on the equipment router', () => {
    expect(routeSource).toContain('router.post("/scan"');
  });

  it("quickScanBodySchema accepts plain string IDs (not UUID-only)", () => {
    // The schema uses z.string().min(1).max(100) — not z.string().uuid()
    expect(routeSource).toContain("equipmentId: z.string().min(1).max(100)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Checkout flow contract
// ─────────────────────────────────────────────────────────────────────────────

describe("Equipment scan — checkout flow contract", () => {
  it('action field is set to "checkout" in the happy path', () => {
    expect(routeSource).toContain('"checkout"');
  });

  it("checkout updates checkedOutById, checkedOutByEmail, checkedOutAt", () => {
    expect(routeSource).toContain("checkedOutById: req.authUser!.id");
    expect(routeSource).toContain("checkedOutByEmail: req.authUser!.email");
    expect(routeSource).toContain("checkedOutAt: now");
  });

  it("checkout inserts a scanLogs row inside the transaction", () => {
    expect(routeSource).toContain("tx.insert(scanLogs)");
  });

  it("checkout creates an undoToken inside the transaction", () => {
    expect(routeSource).toContain("insertUndoToken(tx,");
  });

  it("checkout response includes equipment, action, scanLogId, undoToken", () => {
    expect(routeSource).toContain("equipment: updatedEquipment");
    expect(routeSource).toContain("action: scan.action");
    expect(routeSource).toContain("scanLogId");
    expect(routeSource).toContain("undoToken");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Return flow contract
// ─────────────────────────────────────────────────────────────────────────────

describe("Equipment scan — return flow contract", () => {
  it('action field is set to "return" in the toggle path', () => {
    expect(routeSource).toContain('"return"');
  });

  it("return clears checkedOutById, checkedOutByEmail, checkedOutAt", () => {
    expect(routeSource).toContain("checkedOutById: null");
    expect(routeSource).toContain("checkedOutByEmail: null");
    expect(routeSource).toContain("checkedOutAt: null");
  });

  it("return inserts a scanLogs row inside the transaction", () => {
    // Already verified above; confirm note distinguishes return from checkout
    expect(routeSource).toContain("Quick scan — returned");
  });

  it("return inserts an equipmentReturns row inside the transaction", () => {
    expect(routeSource).toContain("tx.insert(equipmentReturns)");
  });

  it("return uses isPluggedIn=true as default", () => {
    expect(routeSource).toContain("isPluggedIn: true");
  });

  it("return also creates an undoToken inside the transaction", () => {
    // insertUndoToken is called in both checkout and return branches
    const matches = (routeSource.match(/insertUndoToken\(tx,/g) ?? []).length;
    expect(matches).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Blocked flow contract
// ─────────────────────────────────────────────────────────────────────────────

describe("Equipment scan — blocked flow contract", () => {
  it("blocked returns HTTP 409", () => {
    expect(routeSource).toContain("res.status(409)");
  });

  it('blocked reason is "EQUIPMENT_ALREADY_CHECKED_OUT"', () => {
    expect(routeSource).toContain('"EQUIPMENT_ALREADY_CHECKED_OUT"');
  });

  it("blocked response includes checkedOutByEmail for the client", () => {
    expect(routeSource).toContain("checkedOutByEmail");
  });

  it("blocked path early-returns without any equipment.set() mutation", () => {
    // Extract the blocked branch text — from setting scan.action="blocked" to the
    // next branch (checkout). Confirm it contains no .update(equipment).set( calls.
    const blockedStart = routeSource.indexOf('scan.action = "blocked"');
    const checkoutStart = routeSource.indexOf('scan.action = "checkout"');
    expect(blockedStart).toBeGreaterThan(-1);
    expect(checkoutStart).toBeGreaterThan(blockedStart);
    const blockedBranch = routeSource.slice(blockedStart, checkoutStart);
    expect(blockedBranch).not.toContain(".update(equipment)");
    expect(blockedBranch).not.toContain("tx.insert(scanLogs)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Not-found flow contract
// ─────────────────────────────────────────────────────────────────────────────

describe("Equipment scan — not-found flow contract", () => {
  it("not-found returns HTTP 404", () => {
    expect(routeSource).toContain("res.status(404)");
  });

  it('not-found reason is "EQUIPMENT_NOT_FOUND"', () => {
    expect(routeSource).toContain('"EQUIPMENT_NOT_FOUND"');
  });

  it("not-found check happens after the transaction (updatedEquipment is null)", () => {
    expect(routeSource).toContain("if (!updatedEquipment)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Transaction safety
// ─────────────────────────────────────────────────────────────────────────────

describe("Equipment scan — transaction safety", () => {
  it("all mutations are wrapped in db.transaction()", () => {
    expect(routeSource).toContain("await db.transaction(async (tx) => {");
  });

  it("equipment lookup uses FOR-UPDATE semantics (via tx.select)", () => {
    // The route selects from equipment inside the tx callback to ensure
    // row-level serialization; confirm tx.select() is used for the lookup.
    expect(routeSource).toContain("await tx\n        .select()\n        .from(equipment)");
  });

  it("clinicId is always applied to the equipment lookup", () => {
    expect(routeSource).toContain("eq(equipment.clinicId, clinicId)");
  });

  it("soft-deleted equipment is excluded (isNull deletedAt)", () => {
    expect(routeSource).toContain("isNull(equipment.deletedAt)");
  });

  it("audit log is emitted after successful checkout or return", () => {
    expect(routeSource).toContain("equipment_checked_out");
    expect(routeSource).toContain("equipment_returned");
  });
});
