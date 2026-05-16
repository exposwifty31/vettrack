/**
 * Phase 5 PR 5.1 — Clinical-invariant type-shape unit checks.
 *
 * The types file declares pure compile-time contracts (no runtime
 * exports). These tests use the standard "type-only test" pattern:
 *   - Static `satisfies` assertions on representative literal values
 *     verify the union shape compiles only when the contract is
 *     correct.
 *   - Filesystem grep assertions verify the locked enum values and
 *     the locked deny reason (Phase 5 plan §19.5 / §19.6 / §19.19 /
 *     §19.31) — so a future PR cannot silently rename or widen.
 *
 * No runtime construction of an evaluator. The evaluator lands in
 * PR 5.2 — this file deliberately does not import it.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type {
  ClinicalInvariantAllow,
  ClinicalInvariantContext,
  ClinicalInvariantDeny,
  ClinicalInvariantDenyReason,
  ClinicalInvariantDisposition,
  ClinicalInvariantEnforcementMode,
  ClinicalInvariantVerdict,
} from "../server/lib/authority/enforcement/clinical-invariant.types.js";

const TYPES_PATH = resolve(
  __dirname,
  "../server/lib/authority/enforcement/clinical-invariant.types.ts",
);
const typesSource = readFileSync(TYPES_PATH, "utf8");

describe("Phase 5 PR 5.1 — ClinicalInvariantEnforcementMode union (plan §19.5)", () => {
  it("accepts exactly off | shadow | enforce", () => {
    const off: ClinicalInvariantEnforcementMode = "off";
    const shadow: ClinicalInvariantEnforcementMode = "shadow";
    const enforce: ClinicalInvariantEnforcementMode = "enforce";
    expect([off, shadow, enforce]).toEqual(["off", "shadow", "enforce"]);
  });

  it("declares the union in the source file", () => {
    expect(typesSource).toMatch(
      /export\s+type\s+ClinicalInvariantEnforcementMode\s*=\s*"off"\s*\|\s*"shadow"\s*\|\s*"enforce"\s*;/,
    );
  });
});

describe("Phase 5 PR 5.1 — ClinicalInvariantDenyReason (plan §19.6)", () => {
  it("is exactly the single literal ORPHAN_DISPENSE_BLOCKED", () => {
    const r: ClinicalInvariantDenyReason = "ORPHAN_DISPENSE_BLOCKED";
    expect(r).toBe("ORPHAN_DISPENSE_BLOCKED");
  });

  it("source declares the union as exactly one literal", () => {
    expect(typesSource).toMatch(
      /export\s+type\s+ClinicalInvariantDenyReason\s*=\s*"ORPHAN_DISPENSE_BLOCKED"\s*;/,
    );
  });
});

describe("Phase 5 PR 5.1 — ClinicalInvariantDisposition (plan §19.31)", () => {
  it("accepts exactly the four disposition values", () => {
    const off: ClinicalInvariantDisposition = "OFF";
    const bypass: ClinicalInvariantDisposition = "EMERGENCY_BYPASS";
    const shadow: ClinicalInvariantDisposition = "WOULD_HAVE_BLOCKED_SHADOW";
    const degraded: ClinicalInvariantDisposition = "DEGRADED_MODE_FAIL_OPEN";
    expect([off, bypass, shadow, degraded]).toEqual([
      "OFF",
      "EMERGENCY_BYPASS",
      "WOULD_HAVE_BLOCKED_SHADOW",
      "DEGRADED_MODE_FAIL_OPEN",
    ]);
  });

  it("source declares all four disposition values and nothing else", () => {
    const match = typesSource.match(
      /export\s+type\s+ClinicalInvariantDisposition\s*=\s*([^;]+);/,
    );
    expect(match).not.toBeNull();
    const literals = [...match![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(literals.sort()).toEqual(
      ["DEGRADED_MODE_FAIL_OPEN", "EMERGENCY_BYPASS", "OFF", "WOULD_HAVE_BLOCKED_SHADOW"].sort(),
    );
  });
});

describe("Phase 5 PR 5.1 — Verdict shape", () => {
  it("allow verdict accepts an optional disposition", () => {
    const a1: ClinicalInvariantAllow = { action: "allow" };
    const a2: ClinicalInvariantAllow = { action: "allow", disposition: "OFF" };
    expect(a1.action).toBe("allow");
    expect(a2.disposition).toBe("OFF");
  });

  it("deny verdict carries reason + orphanLines (plan §6.3)", () => {
    const d: ClinicalInvariantDeny = {
      action: "deny",
      reason: "ORPHAN_DISPENSE_BLOCKED",
      orphanLines: [
        {
          itemId: "item-1",
          quantity: 1,
          label: "Drug X",
          reasons: ["NO_ACTIVE_ORDER"],
          matchingOrderIds: [],
        },
      ],
    };
    expect(d.reason).toBe("ORPHAN_DISPENSE_BLOCKED");
    expect(d.orphanLines).toHaveLength(1);
  });

  it("verdict union discriminates on `action`", () => {
    const v: ClinicalInvariantVerdict = { action: "allow" };
    if (v.action === "allow") {
      // `disposition` is optional on the allow side.
      expect(v.disposition).toBeUndefined();
    } else {
      // Unreachable — but exercises the discriminator at compile time.
      expect(v.reason).toBe("ORPHAN_DISPENSE_BLOCKED");
      expect(v.orphanLines).toBeDefined();
    }
  });
});

describe("Phase 5 PR 5.1 — ClinicalInvariantContext shape (plan §6.1, §19.19)", () => {
  it("requires containerId as a non-nullable string", () => {
    // Static check: `containerId` declared as `string` (NOT `string | null`).
    expect(typesSource).toMatch(/containerId:\s*string\s*;/);
    expect(typesSource).not.toMatch(/containerId:\s*string\s*\|\s*null/);
    expect(typesSource).not.toMatch(/containerId\?\s*:\s*string/);
  });

  it("permits animalId as nullable (orphan `NO_PATIENT_LINKED` flow)", () => {
    expect(typesSource).toMatch(/animalId:\s*string\s*\|\s*null\s*;/);
  });

  it("permits bypassReason as nullable", () => {
    expect(typesSource).toMatch(/bypassReason:\s*string\s*\|\s*null\s*;/);
  });

  it("requires tx, clinicId, lines, isEmergency, requestId fields", () => {
    expect(typesSource).toMatch(/tx:\s*AuditDbExecutor\s*;/);
    expect(typesSource).toMatch(/clinicId:\s*string\s*;/);
    expect(typesSource).toMatch(/lines:\s*DispenseLineForValidation\[\]\s*;/);
    expect(typesSource).toMatch(/isEmergency:\s*boolean\s*;/);
    expect(typesSource).toMatch(/requestId:\s*string\s*;/);
  });

  it("type-level: a representative context value compiles", () => {
    // Construct a minimal stub. `tx` is typed against the real
    // AuditDbExecutor — at runtime any object will do for this shape
    // test, but TypeScript would reject a non-assignable shape.
    const ctx: ClinicalInvariantContext = {
      tx: {} as ClinicalInvariantContext["tx"],
      clinicId: "clinic-1",
      animalId: null,
      containerId: "container-1",
      lines: [],
      isEmergency: false,
      bypassReason: null,
      requestId: "req-1",
    };
    expect(ctx.clinicId).toBe("clinic-1");
    expect(ctx.containerId).toBe("container-1");
  });
});

describe("Phase 5 PR 5.1 — Import-boundary discipline (plan §17 + §19.17)", () => {
  it("imports only pure type contracts (AuditDbExecutor + dispense-order-validation types)", () => {
    const importRe = /^\s*import\b[^;]*?from\s+["']([^"']+)["']\s*;?$/gm;
    const specs = Array.from(typesSource.matchAll(importRe)).map((m) => m[1]);
    const allowed = new Set([
      "../../audit.js",
      "../../dispense-order-validation.js",
    ]);
    for (const spec of specs) {
      expect(allowed, `unexpected import: ${spec}`).toContain(spec);
    }
  });

  it("imports nothing from other evaluator family files", () => {
    expect(typesSource).not.toMatch(/from\s+["']\.\/stale\.evaluator/);
    expect(typesSource).not.toMatch(/from\s+["']\.\/oprole\.evaluator/);
    expect(typesSource).not.toMatch(/from\s+["']\.\/task-assignment/);
    expect(typesSource).not.toMatch(/from\s+["']\.\/stale-task-ownership/);
    expect(typesSource).not.toMatch(/from\s+["']\.\/code-blue-manager/);
  });

  it("all imports are `import type` (compile-time only)", () => {
    const importLines = typesSource.match(/^\s*import\b[^;]*?from\s+["'][^"']+["']\s*;?$/gm) ?? [];
    for (const line of importLines) {
      expect(line).toMatch(/^\s*import\s+type\b/);
    }
  });
});
