/**
 * Static-analysis tests for Phase 1 PR 1.5 — Code Blue 15-minute server-side gate.
 *
 * Verifies structural patterns in server/routes/code-blue.ts:
 *   1. Reject end-session when duration < 15 min and no earlyStopReason
 *   2. Reject end-session when manager lacks vet/admin role
 *   3. Allow normal closure at >= 15 min
 *   4. Allow early closure with earlyStopReason + vet manager
 *   5. Regression: existing MANAGER_ONLY enforcement still present
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const routes = fs.readFileSync(path.join(root, "server/routes/code-blue.ts"), "utf8");

// Narrow to the end-session handler block for positional assertions
const endHandlerStart = routes.indexOf("sessions/:id/end");
const endHandlerBlock = endHandlerStart !== -1 ? routes.slice(endHandlerStart) : "";

// ─────────────────────────────────────────────────────────────────────────────
// Schema — earlyStopReason field
// ─────────────────────────────────────────────────────────────────────────────

describe("Code Blue 15-min gate — schema", () => {
  it("endSessionSchema includes earlyStopReason field", () => {
    expect(routes).toContain("earlyStopReason");
  });

  it("earlyStopReason is optional in the schema", () => {
    // Must appear as .optional() — not required
    const schemaBlock = routes.slice(routes.indexOf("endSessionSchema"), routes.indexOf("endSessionSchema") + 500);
    expect(schemaBlock).toMatch(/earlyStopReason[\s\S]{0,60}optional/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reject: < 15 min without earlyStopReason
// ─────────────────────────────────────────────────────────────────────────────

describe("Code Blue 15-min gate — TOO_EARLY rejection", () => {
  it("handler contains TOO_EARLY error code", () => {
    expect(endHandlerBlock).toContain("TOO_EARLY");
  });

  it("handler uses FIFTEEN_MINUTES_MS constant or equivalent duration check", () => {
    expect(endHandlerBlock).toMatch(/FIFTEEN_MINUTES_MS|15\s*\*\s*60\s*\*\s*1000/);
  });

  it("TOO_EARLY gate is conditional on absence of earlyStopReason", () => {
    // The gate must check !earlyStopReason (or equivalent falsy check)
    const gateSection = endHandlerBlock.slice(0, endHandlerBlock.indexOf("TOO_EARLY") + 200);
    expect(gateSection).toMatch(/!earlyStopReason|earlyStopReason[\s\S]{0,30}false/);
  });

  it("returns 422 for TOO_EARLY", () => {
    // 422 must appear near TOO_EARLY
    const nearTooEarly = endHandlerBlock.slice(
      Math.max(0, endHandlerBlock.indexOf("TOO_EARLY") - 100),
      endHandlerBlock.indexOf("TOO_EARLY") + 200,
    );
    expect(nearTooEarly).toContain("422");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reject: no Vet manager
// ─────────────────────────────────────────────────────────────────────────────

describe("Code Blue 15-min gate — NO_VET_MANAGER rejection", () => {
  it("handler contains NO_VET_MANAGER error code", () => {
    expect(endHandlerBlock).toContain("NO_VET_MANAGER");
  });

  it("handler looks up manager role from DB", () => {
    // Must select from users table inside the handler
    const afterManagerOnlyGate = endHandlerBlock.slice(endHandlerBlock.indexOf("MANAGER_ONLY"));
    expect(afterManagerOnlyGate).toMatch(/from\(users\)|\.from\s*\(\s*users\s*\)/);
  });

  it("handler checks for vet or admin role", () => {
    expect(endHandlerBlock).toContain('"vet"');
    expect(endHandlerBlock).toContain('"admin"');
  });

  it("returns 422 for NO_VET_MANAGER", () => {
    const nearNoVetManager = endHandlerBlock.slice(
      Math.max(0, endHandlerBlock.indexOf("NO_VET_MANAGER") - 100),
      endHandlerBlock.indexOf("NO_VET_MANAGER") + 200,
    );
    expect(nearNoVetManager).toContain("422");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Gate ordering — vet-manager check precedes 15-min gate
// ─────────────────────────────────────────────────────────────────────────────

describe("Code Blue 15-min gate — check ordering", () => {
  it("NO_VET_MANAGER check appears before TOO_EARLY check", () => {
    const noVetPos = endHandlerBlock.indexOf("NO_VET_MANAGER");
    const tooEarlyPos = endHandlerBlock.indexOf("TOO_EARLY");
    expect(noVetPos).toBeGreaterThan(-1);
    expect(tooEarlyPos).toBeGreaterThan(-1);
    expect(noVetPos).toBeLessThan(tooEarlyPos);
  });

  it("MANAGER_ONLY check appears before NO_VET_MANAGER check", () => {
    const managerOnlyPos = endHandlerBlock.indexOf("MANAGER_ONLY");
    const noVetPos = endHandlerBlock.indexOf("NO_VET_MANAGER");
    expect(managerOnlyPos).toBeLessThan(noVetPos);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TODO marker — Phase 4 PR 4.3 closed the manager-authority shadow wiring.
// The old marker is replaced; the new marker tracks PR 4.5 enforce activation.
// ─────────────────────────────────────────────────────────────────────────────

describe("Code Blue 15-min gate — TODO marker (post Phase 4 PR 4.3)", () => {
  it("does NOT contain the legacy Phase 4 + Phase 2.5 TODO marker (closed by PR 4.3)", () => {
    expect(routes).not.toContain("TODO(Phase 4 + Phase 2.5)");
  });

  it("contains the post-PR-4.3 enforce-activation TODO marker", () => {
    expect(routes).toContain(
      "TODO(Phase 4): activate enforce mode for end via per-clinic vt_server_config after shadow soak",
    );
  });

  it("PATCH /sessions/:id/end invokes evaluateCodeBlueManagerForRoute with endpoint=\"end\"", () => {
    // The end handler must call the Phase 4 manager evaluator wiring.
    // The route declaration may span multiple lines (clinical middleware
    // chain added in PR 4.3); the regex tolerates whitespace/newlines
    // between `router.patch(` and `"/sessions/:id/end"`.
    expect(routes).toContain("evaluateCodeBlueManagerForRoute");
    const endHandlerStart = routes.search(
      /router\.patch\(\s*["']\/sessions\/:id\/end["']/,
    );
    expect(endHandlerStart).toBeGreaterThanOrEqual(0);
    const endHandlerEnd = routes.indexOf("\nrouter.", endHandlerStart + 1);
    const endHandlerBlock = routes.slice(
      endHandlerStart,
      endHandlerEnd > endHandlerStart ? endHandlerEnd : endHandlerStart + 6000,
    );
    expect(endHandlerBlock).toMatch(/endpoint\s*:\s*["']end["']/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Regression: existing gates still present
// ─────────────────────────────────────────────────────────────────────────────

describe("Code Blue 15-min gate — regression: existing enforcement intact", () => {
  it("MANAGER_ONLY 403 gate still exists", () => {
    expect(endHandlerBlock).toContain("MANAGER_ONLY");
    expect(endHandlerBlock).toContain("403");
  });

  it("end route manager check still applies to ALL outcomes (precedes outcome handling)", () => {
    const manager403Pos = endHandlerBlock.indexOf("MANAGER_ONLY");
    const diedPos = endHandlerBlock.indexOf('"died"');
    if (diedPos !== -1) {
      expect(manager403Pos).toBeLessThan(diedPos);
    }
    expect(manager403Pos).toBeGreaterThan(-1);
  });

  it("earlyStopReason is included in the session summary when provided", () => {
    expect(endHandlerBlock).toContain("early_stop_reason");
  });
});
