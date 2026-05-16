/**
 * Phase 5 PR 5.6 — clinical-invariant JSON error envelope tests.
 *
 * Verifies the §6.3 envelope shape byte-for-byte AND the §6.3
 * stability-matrix locks:
 *
 *   - `code` = `"CLINICAL_INVARIANT_VIOLATION"` (frozen)
 *   - `reason` = `"ORPHAN_DISPENSE_BLOCKED"` (frozen)
 *   - `clinical` = `true` (frozen discriminator)
 *   - `requestId` propagated from input
 *   - `cop.kind` = `"orphan_dispense"` (frozen)
 *   - `cop.orphanLines[]` carries the stable per-line fields
 *   - `message` is the fixed English fallback (non-contractual, but
 *     pinned to its current text so we notice if a future PR
 *     accidentally changes it without explicit approval)
 *   - No locale keys in the source (CI-19 / §19.21)
 *   - No legacy `error: code` alias (Phase 5 plan §6.3 strict shape)
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildClinicalInvariantError,
  CLINICAL_INVARIANT_COP_KIND,
  CLINICAL_INVARIANT_ERROR_CODE,
  CLINICAL_INVARIANT_ERROR_MESSAGE,
  CLINICAL_INVARIANT_ERROR_REASON,
} from "../server/lib/clinical-invariant-error.js";
import type { OrphanLineDetail } from "../server/lib/dispense-order-validation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const helperPath = path.join(
  __dirname,
  "..",
  "server",
  "lib",
  "clinical-invariant-error.ts",
);
const helperSource = fs.readFileSync(helperPath, "utf8");

function orphan(
  itemId: string,
  reasons: OrphanLineDetail["reasons"],
  quantity = 1,
  matchingOrderIds: OrphanLineDetail["matchingOrderIds"] = [],
): OrphanLineDetail {
  return {
    itemId,
    quantity,
    label: `label-${itemId}`,
    reasons: [...reasons],
    matchingOrderIds: [...matchingOrderIds],
  };
}

describe("Phase 5 PR 5.6 — frozen constant exports", () => {
  it("CLINICAL_INVARIANT_ERROR_CODE is exactly `\"CLINICAL_INVARIANT_VIOLATION\"`", () => {
    expect(CLINICAL_INVARIANT_ERROR_CODE).toBe("CLINICAL_INVARIANT_VIOLATION");
  });

  it("CLINICAL_INVARIANT_ERROR_REASON is exactly `\"ORPHAN_DISPENSE_BLOCKED\"`", () => {
    expect(CLINICAL_INVARIANT_ERROR_REASON).toBe("ORPHAN_DISPENSE_BLOCKED");
  });

  it("CLINICAL_INVARIANT_COP_KIND is exactly `\"orphan_dispense\"`", () => {
    expect(CLINICAL_INVARIANT_COP_KIND).toBe("orphan_dispense");
  });

  it("CLINICAL_INVARIANT_ERROR_MESSAGE is the documented English fallback", () => {
    // Non-contractual but pinned to detect accidental drift. The
    // future UI/i18n phase may explicitly approve a change here.
    expect(CLINICAL_INVARIANT_ERROR_MESSAGE).toBe(
      "Dispense does not match active orders for this patient/container context.",
    );
  });
});

describe("Phase 5 PR 5.6 — buildClinicalInvariantError envelope shape (§6.3)", () => {
  it("produces an envelope whose top-level keys are exactly { code, reason, message, requestId, clinical, cop }", () => {
    const body = buildClinicalInvariantError({
      requestId: "req-1",
      orphanLines: [orphan("item-1", ["NO_ACTIVE_ORDER"])],
    });
    expect(Object.keys(body).sort()).toEqual(
      ["clinical", "code", "cop", "message", "reason", "requestId"].sort(),
    );
  });

  it("populates the stable machine-readable contract fields", () => {
    const body = buildClinicalInvariantError({
      requestId: "req-stable",
      orphanLines: [orphan("item-1", ["NO_ACTIVE_ORDER"])],
    });
    expect(body.code).toBe("CLINICAL_INVARIANT_VIOLATION");
    expect(body.reason).toBe("ORPHAN_DISPENSE_BLOCKED");
    expect(body.clinical).toBe(true);
    expect(body.requestId).toBe("req-stable");
    expect(body.cop.kind).toBe("orphan_dispense");
  });

  it("populates cop.orphanLines with itemId / quantity / reasons / matchingOrderIds (stable fields)", () => {
    const body = buildClinicalInvariantError({
      requestId: "req-lines",
      orphanLines: [
        orphan("item-A", ["NO_PATIENT_LINKED"], 1, []),
        orphan("item-B", ["NO_ACTIVE_HOSPITALIZATION", "NO_ACTIVE_ORDER"], 2, ["order-1"]),
        orphan("item-C", ["QUANTITY_EXCEEDS_ORDER"], 3, ["order-2", "order-3"]),
      ],
    });
    expect(body.cop.orphanLines).toHaveLength(3);
    expect(body.cop.orphanLines[0]).toMatchObject({
      itemId: "item-A",
      quantity: 1,
      reasons: ["NO_PATIENT_LINKED"],
      matchingOrderIds: [],
    });
    expect(body.cop.orphanLines[1]).toMatchObject({
      itemId: "item-B",
      quantity: 2,
      reasons: ["NO_ACTIVE_HOSPITALIZATION", "NO_ACTIVE_ORDER"],
      matchingOrderIds: ["order-1"],
    });
    expect(body.cop.orphanLines[2]).toMatchObject({
      itemId: "item-C",
      quantity: 3,
      reasons: ["QUANTITY_EXCEEDS_ORDER"],
      matchingOrderIds: ["order-2", "order-3"],
    });
  });

  it("empty orphanLines produces a valid envelope with an empty cop.orphanLines array", () => {
    const body = buildClinicalInvariantError({
      requestId: "req-empty",
      orphanLines: [],
    });
    expect(body.cop.orphanLines).toEqual([]);
    expect(body.cop.kind).toBe("orphan_dispense");
  });

  it("returns a defensive copy of orphanLines (mutating the input does not mutate the body)", () => {
    const input: OrphanLineDetail[] = [
      orphan("item-1", ["NO_ACTIVE_ORDER"], 1, ["order-orig"]),
    ];
    const body = buildClinicalInvariantError({ requestId: "req-defensive", orphanLines: input });

    // Mutate the input after construction.
    input.push(orphan("item-extra", ["NO_PATIENT_LINKED"]));
    input[0]!.quantity = 999;
    input[0]!.reasons.push("NO_ACTIVE_HOSPITALIZATION");
    input[0]!.matchingOrderIds.push("order-mutated");

    // The body's view is unchanged.
    expect(body.cop.orphanLines).toHaveLength(1);
    expect(body.cop.orphanLines[0]!.quantity).toBe(1);
    expect(body.cop.orphanLines[0]!.reasons).toEqual(["NO_ACTIVE_ORDER"]);
    expect(body.cop.orphanLines[0]!.matchingOrderIds).toEqual(["order-orig"]);
  });

  it("does NOT include a legacy `error: code` alias field (Phase 5 plan §6.3 strict shape)", () => {
    const body = buildClinicalInvariantError({
      requestId: "req-no-error-alias",
      orphanLines: [orphan("item-1", ["NO_ACTIVE_ORDER"])],
    });
    expect("error" in body).toBe(false);
  });
});

describe("Phase 5 PR 5.6 — source-level locks", () => {
  it("helper source does NOT import any locale module (CI-19, §19.21)", () => {
    expect(helperSource).not.toMatch(/from\s+["'].*locales\//);
    expect(helperSource).not.toMatch(/from\s+["'].*i18n/i);
  });

  it("helper source does NOT contain any executable locale-key reference", () => {
    // Strip line-comments before scanning so the documentation
    // mentioning `t.cop.*` (which is what we explicitly forbid) does
    // not trigger a false positive on our own guard rail.
    const sourceWithoutLineComments = helperSource
      .split(/\r?\n/)
      .map((line) => {
        const idx = line.indexOf("//");
        return idx >= 0 ? line.slice(0, idx) : line;
      })
      .join("\n")
      // Block comments span multi-line; strip them too.
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(sourceWithoutLineComments).not.toMatch(/\bt\.[a-zA-Z]+\.[a-zA-Z]/);
    expect(sourceWithoutLineComments).not.toMatch(/getCurrentLocale/);
  });

  it("frozen constants are exported with the documented values (defence-in-depth)", () => {
    expect(helperSource).toMatch(
      /export const CLINICAL_INVARIANT_ERROR_CODE\s*=\s*"CLINICAL_INVARIANT_VIOLATION"\s+as\s+const\s*;/,
    );
    expect(helperSource).toMatch(
      /export const CLINICAL_INVARIANT_ERROR_REASON\s*=\s*"ORPHAN_DISPENSE_BLOCKED"\s+as\s+const\s*;/,
    );
    expect(helperSource).toMatch(
      /export const CLINICAL_INVARIANT_COP_KIND\s*=\s*"orphan_dispense"\s+as\s+const\s*;/,
    );
  });

  it("helper is now imported by the two wired call sites (dispense-confirm service + containers dispense route) — PR 5.7", async () => {
    // PR 5.6 originally asserted no caller existed yet. PR 5.7 wires
    // the helper into the two production call sites — the assertion
    // inverts here so the test continues to track the helper's
    // expected consumers across phases.
    const fs2 = await import("node:fs");
    const repoRoot = path.join(__dirname, "..");
    const dispenseService = fs2.readFileSync(
      path.join(repoRoot, "server", "services", "dispense.service.ts"),
      "utf8",
    );
    const containersRoute = fs2.readFileSync(
      path.join(repoRoot, "server", "routes", "containers.ts"),
      "utf8",
    );
    expect(dispenseService).toMatch(
      /buildClinicalInvariantError|clinical-invariant-error/,
    );
    expect(containersRoute).toMatch(
      /buildClinicalInvariantError|clinical-invariant-error/,
    );
  });
});
