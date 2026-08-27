import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SERVICE = "server/services/equipment-custody-toggle.service.ts";
const TOKENS = "server/routes/equipment/equipment-undo-tokens.ts";
const REVERT = "server/routes/equipment/handlers/post-equipment-revert.ts";

/**
 * Reads the balanced `{ ... }` object literal that follows `decl`.
 * Used to derive what the undoable mutations actually write, rather than
 * re-stating a hand-maintained list that drifts exactly the way the snapshot did.
 */
function literalAfter(src: string, decl: string): string {
  const declIdx = src.indexOf(decl);
  if (declIdx < 0) throw new Error(`declaration not found: ${decl}`);
  const start = src.indexOf("{", declIdx);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start + 1, i);
    }
  }
  throw new Error(`unbalanced braces after: ${decl}`);
}

function objectKeys(body: string): string[] {
  return [...body.matchAll(/(?:^|[\s{,])([A-Za-z_$][\w$]*)\s*:/g)].map((m) => m[1]);
}

/**
 * `version` is excluded: the revert handler deliberately does NOT restore the
 * previous version, it increments (`version + 1`) so the optimistic-concurrency
 * pin keeps moving forward. Restoring it would defeat the F4 version guard.
 */
const NOT_RESTORABLE = new Set(["version"]);

function columnsWrittenByUndoableMutations(): string[] {
  const src = readFileSync(SERVICE, "utf8");
  const written = [
    ...objectKeys(literalAfter(src, "const checkoutSet =")),
    ...objectKeys(literalAfter(src, "const returnSet =")),
  ];
  return [...new Set(written)].filter((k) => !NOT_RESTORABLE.has(k)).sort();
}

describe("S7: undo snapshot covers every column an undoable mutation writes", () => {
  it("derives a non-trivial set of written columns (guards the oracle itself)", () => {
    const written = columnsWrittenByUndoableMutations();
    // If the parser silently matched nothing, the coverage assertions below
    // would pass vacuously. A gate that cannot go red is not a gate.
    expect(written.length).toBeGreaterThan(8);
    expect(written).toContain("custodyState");
    expect(written).toContain("checkedOutById");
  });

  it("EquipmentPreviousState declares every written column", () => {
    const tokensSrc = readFileSync(TOKENS, "utf8");
    const iface = literalAfter(tokensSrc, "export interface EquipmentPreviousState");
    const declared = new Set(objectKeys(iface));
    const missing = columnsWrittenByUndoableMutations().filter((c) => !declared.has(c));
    expect(missing).toEqual([]);
  });

  it("snapshotEquipmentState captures every written column", () => {
    const tokensSrc = readFileSync(TOKENS, "utf8");
    const body = literalAfter(tokensSrc, "export function snapshotEquipmentState");
    const captured = new Set(objectKeys(body));
    const missing = columnsWrittenByUndoableMutations().filter((c) => !captured.has(c));
    expect(missing).toEqual([]);
  });

  it("the revert transaction restores every written column", () => {
    const revertSrc = readFileSync(REVERT, "utf8");
    const setBody = literalAfter(revertSrc, ".set(");
    const restored = new Set(objectKeys(setBody));
    const missing = columnsWrittenByUndoableMutations().filter((c) => !restored.has(c));
    expect(missing).toEqual([]);
  });

  it("checkout writes custody_state, so revert must clear it — no holder-less 'checked_out' row", () => {
    const serviceSrc = readFileSync(SERVICE, "utf8");
    expect(literalAfter(serviceSrc, "const checkoutSet =")).toContain("custodyState");

    const revertSrc = readFileSync(REVERT, "utf8");
    const setBody = literalAfter(revertSrc, ".set(");
    // checkedOutById is already restored; custodyState must move with it or the
    // row renders "בהשאלה" with no holder and no return action.
    expect(setBody).toContain("checkedOutById: prev.checkedOutById");
    expect(setBody).toContain("custodyState: prev.custodyState");
  });
});

describe("S8: undo preserves the scan log", () => {
  it("the revert transaction does not delete the scan log", () => {
    const revertSrc = readFileSync(REVERT, "utf8");
    expect(revertSrc).not.toMatch(/\.delete\(\s*scanLogs\s*\)/);
  });

  it("history keeps both sides of the event: the scan stays, the revert is audited", () => {
    const revertSrc = readFileSync(REVERT, "utf8");
    expect(revertSrc).toContain('actionType: "equipment_reverted"');
    // The scan row is the evidence the custody event happened at all; deleting it
    // makes History read "no scans yet" after a real checkout.
    expect(revertSrc).not.toContain("delete(scanLogs)");
  });
});
