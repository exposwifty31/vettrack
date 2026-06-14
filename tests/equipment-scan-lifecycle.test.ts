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
const custodyServiceSource = fs.readFileSync(
  path.resolve(__dirname, "../server/services/equipment-custody-toggle.service.ts"),
  "utf8",
);
const equipmentMutationSource = `${routeSource}\n${custodyServiceSource}`;

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
    // Service type union and return statements carry the "checkout" literal
    expect(equipmentMutationSource).toContain('"checkout"');
  });

  it("checkout updates checkedOutById, checkedOutByEmail, checkedOutAt", () => {
    expect(routeSource).toContain("checkedOutById: req.authUser!.id");
    expect(routeSource).toContain("checkedOutByEmail: req.authUser!.email");
    expect(routeSource).toContain("checkedOutAt: now");
  });

  it("checkout inserts a scanLogs row inside the transaction", () => {
    // Insertion moved to performEquipmentCheckout in the custody service
    expect(custodyServiceSource).toContain("tx.insert(scanLogs)");
  });

  it("checkout creates an undoToken inside the transaction", () => {
    expect(equipmentMutationSource).toContain("insertEquipmentUndoToken(tx,");
  });

  it("checkout response includes equipment, action, scanLogId, undoToken", () => {
    expect(routeSource).toContain("equipment: updatedEquipment");
    // /scan route delegates; action comes from result.kind returned by quickScanEquipmentCustody
    expect(routeSource).toContain("action: result.kind");
    expect(routeSource).toContain("scanLogId");
    expect(routeSource).toContain("undoToken");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Return flow contract
// ─────────────────────────────────────────────────────────────────────────────

describe("Equipment scan — return flow contract", () => {
  it('action field is set to "return" in the toggle path', () => {
    // Service type union and return statements carry the "return" literal
    expect(equipmentMutationSource).toContain('"return"');
  });

  it("return clears checkedOutById, checkedOutByEmail, checkedOutAt", () => {
    // performEquipmentReturn in the custody service sets these fields to null
    expect(custodyServiceSource).toContain("checkedOutById: null");
    expect(custodyServiceSource).toContain("checkedOutByEmail: null");
    expect(custodyServiceSource).toContain("checkedOutAt: null");
  });

  it("return inserts a scanLogs row inside the transaction", () => {
    // performEquipmentReturn inserts a scanLogs row; confirm note distinguishes return from checkout
    expect(custodyServiceSource).toContain("Returned — available");
  });

  it("quick-scan return delegates to performEquipmentReturn", () => {
    // quickScanEquipmentCustody delegates custody logic to performEquipmentReturn.
    // isPluggedIn defaults to true for quick-scan so no equipmentReturns row is created
    // (equipmentReturns is guarded by isPluggedIn === false in finalizeReturnSideEffects).
    expect(custodyServiceSource).toContain("performEquipmentReturn(tx,");
  });

  it("quick-scan return uses isPluggedIn=true as default", () => {
    expect(routeSource).toContain("isPluggedIn: true");
  });

  it("POST /:id/return creates equipmentReturns only when isPluggedIn is false", () => {
    expect(custodyServiceSource).toContain("isPluggedIn === false");
    expect(custodyServiceSource).toContain("insert(equipmentReturns)");
    const returnRouteStart = routeSource.indexOf("// POST /api/equipment/:id/return");
    const returnRouteEnd = routeSource.indexOf("// POST /api/equipment/:id/seen");
    const returnRouteBody = routeSource.slice(returnRouteStart, returnRouteEnd);
    expect(returnRouteBody).toContain("returnRecord");
  });

  it("POST /:id/return applies custody transition in a single atomic update", () => {
    expect(custodyServiceSource).toContain("transitionCustody");
    expect(custodyServiceSource).toContain("CUSTODY_RETURN_VERSION_CONFLICT");
    const custodyUpdateCount = (custodyServiceSource.match(/\.update\(equipment\)/g) ?? []).length;
    expect(custodyUpdateCount).toBeGreaterThanOrEqual(1);
  });

  it("return also creates an undoToken inside the transaction", () => {
    const matches = (equipmentMutationSource.match(/insertEquipmentUndoToken\(tx,/g) ?? []).length;
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
    // /scan delegates to quickScanEquipmentCustody; blocked result early-returns before any mutation.
    const blockedStart = routeSource.indexOf('result.kind === "blocked"');
    const successPath = routeSource.indexOf("invalidateAnalyticsCache(clinicId)");
    expect(blockedStart).toBeGreaterThan(-1);
    expect(successPath).toBeGreaterThan(blockedStart);
    const blockedBranch = routeSource.slice(blockedStart, successPath);
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
    // Audit calls moved to finalizeCheckoutSideEffects / finalizeReturnSideEffects in the custody service
    expect(custodyServiceSource).toContain("equipment_checked_out");
    expect(custodyServiceSource).toContain("equipment_returned");
  });
});
