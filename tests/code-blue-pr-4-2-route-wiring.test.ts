/**
 * Phase 4 PR 4.2 — Source-level invariants on the Code Blue initiation route.
 *
 * These are static-analysis tests over server/routes/code-blue.ts. They lock
 * the structural invariants the runtime tests can't easily express:
 *   - POST /sessions uses requireClinicalAuthority (not just requireAuth).
 *   - The gate uses allowSystemAdmin:false explicitly.
 *   - The manager wiring helper is invoked BEFORE the DB insert / push /
 *     system-message side effects (so a deny in PR 4.5+ never half-commits).
 *   - The wiring helper does not read req.authoritySnapshot.
 *   - Wiring file lives outside the enforcement/ isolation boundary.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const routeFile = path.join(repoRoot, "server", "routes", "code-blue.ts");
const wiringFile = path.join(
  repoRoot,
  "server",
  "lib",
  "authority",
  "code-blue-manager.wiring.ts",
);

const routeSrc = fs.readFileSync(routeFile, "utf8");
const wiringSrc = fs.readFileSync(wiringFile, "utf8");

// ─────────────────────────────────────────────────────────────────────────────
// Middleware chain on POST /sessions

describe("POST /api/code-blue/sessions — middleware chain", () => {
  it("imports requireClinicalAuthority from server/middleware/authority", () => {
    expect(routeSrc).toMatch(
      /import\s*\{[^}]*requireClinicalAuthority[^}]*\}\s*from\s*["']\.\.\/middleware\/authority\.js["']/,
    );
  });

  it("imports requireClinicalUser from server/middleware/auth", () => {
    expect(routeSrc).toMatch(
      /import\s*\{[^}]*requireClinicalUser[^}]*\}\s*from\s*["']\.\.\/middleware\/auth\.js["']/,
    );
  });

  it("registers POST /sessions with requireClinicalAuthority in the middleware chain", () => {
    const idx = routeSrc.indexOf('router.post(');
    const sessionsIdx = routeSrc.indexOf('"/sessions"');
    expect(sessionsIdx).toBeGreaterThan(idx);
    // The handler block runs from the "/sessions" string to the next router.<method>(
    const handlerSlice = routeSrc.slice(
      sessionsIdx,
      routeSrc.indexOf("router.", sessionsIdx + 20),
    );
    expect(handlerSlice).toContain("requireClinicalAuthority");
    expect(handlerSlice).toContain("requireClinicalUser");
  });

  it("uses allowSystemAdmin: false on POST /sessions clinical gate", () => {
    const sessionsIdx = routeSrc.indexOf('"/sessions"');
    const handlerSlice = routeSrc.slice(
      sessionsIdx,
      routeSrc.indexOf("router.", sessionsIdx + 20),
    );
    expect(handlerSlice).toMatch(/allowSystemAdmin\s*:\s*false/);
  });

  it("uses the standard clinical allow list (vet, senior_technician, technician)", () => {
    const sessionsIdx = routeSrc.indexOf('"/sessions"');
    const handlerSlice = routeSrc.slice(
      sessionsIdx,
      routeSrc.indexOf("router.", sessionsIdx + 20),
    );
    expect(handlerSlice).toContain('"vet"');
    expect(handlerSlice).toContain('"senior_technician"');
    expect(handlerSlice).toContain('"technician"');
  });

  it("does NOT use the legacy dispense fallback option on Code Blue gates", () => {
    expect(routeSrc).not.toContain(
      "allowPermanentClinicalRoleFallbackForLegacyDispense",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Wiring + side-effect ordering on POST /sessions

describe("POST /api/code-blue/sessions — manager evaluator wiring", () => {
  const sessionsIdx = routeSrc.indexOf('"/sessions"');
  const handlerSlice = routeSrc.slice(
    sessionsIdx,
    routeSrc.indexOf("router.", sessionsIdx + 20),
  );

  it("calls evaluateCodeBlueManagerForRoute with endpoint='initiation'", () => {
    expect(handlerSlice).toContain("evaluateCodeBlueManagerForRoute");
    expect(handlerSlice).toMatch(/endpoint\s*:\s*["']initiation["']/);
  });

  it("evaluator wiring runs BEFORE the codeBlueSessions DB insert", () => {
    const wiringIdx = handlerSlice.indexOf("evaluateCodeBlueManagerForRoute");
    const insertIdx = handlerSlice.indexOf("insert(codeBlueSessions)");
    expect(wiringIdx).toBeGreaterThan(0);
    expect(insertIdx).toBeGreaterThan(0);
    expect(wiringIdx).toBeLessThan(insertIdx);
  });

  it("evaluator wiring runs BEFORE the push fan-out enqueueNotificationJob", () => {
    const wiringIdx = handlerSlice.indexOf("evaluateCodeBlueManagerForRoute");
    const pushIdx = handlerSlice.indexOf("enqueueNotificationJob");
    expect(wiringIdx).toBeLessThan(pushIdx);
  });

  it("evaluator wiring runs BEFORE the system-message post", () => {
    const wiringIdx = handlerSlice.indexOf("evaluateCodeBlueManagerForRoute");
    const sysMsgIdx = handlerSlice.indexOf("postSystemMessage");
    expect(wiringIdx).toBeLessThan(sysMsgIdx);
  });

  it('evaluator wiring runs BEFORE the "code_blue_started" audit', () => {
    const wiringIdx = handlerSlice.indexOf("evaluateCodeBlueManagerForRoute");
    const auditIdx = handlerSlice.indexOf('"code_blue_started"');
    expect(wiringIdx).toBeLessThan(auditIdx);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Initiator denial observability

describe("POST /api/code-blue/sessions — initiator denial observer", () => {
  it("registers a denial observer middleware that emits the Code Blue initiator counter and audit kind", () => {
    expect(routeSrc).toContain("codeBlueInitiatorDenialObserver");
    expect(routeSrc).toContain("codeBlueManagerMetrics.initiatorDenied()");
    expect(routeSrc).toContain('"code_blue_initiator_authority_denied"');
  });

  it("observer runs ONLY when statusCode === 403 (clinical gate denial)", () => {
    expect(routeSrc).toMatch(/res\.statusCode\s*!==?\s*403/);
  });

  it("post-gate marker clears the denial flag after the gate passes", () => {
    expect(routeSrc).toContain("codeBlueInitiatorGatePassedMarker");
    expect(routeSrc).toMatch(/__cbInitiatorGatePassed\s*=\s*true/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Architectural invariants on the wiring file

describe("server/lib/authority/code-blue-manager.wiring.ts — architectural invariants", () => {
  it("does NOT import the Express Request type or DEREFERENCE req.authoritySnapshot", () => {
    // The string `authoritySnapshot` is allowed in doc comments (this file
    // explicitly states it never reads that property). The structural check
    // is that the wiring's executable code does not import any Express types
    // and does not dereference `.authoritySnapshot` on any object.
    const wiringCode = wiringSrc.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    expect(wiringCode).not.toMatch(/from\s+["']express["']/);
    expect(wiringCode).not.toMatch(/\.authoritySnapshot\b/);
  });

  it("imports resolveAuthority from the existing resolver (no parallel framework)", () => {
    expect(wiringSrc).toMatch(/from\s+["']\.\.\/authority\.js["']/);
    expect(wiringSrc).toContain("resolveAuthority");
  });

  it("invokes the frozen PR 4.1 evaluator", () => {
    expect(wiringSrc).toContain("evaluateCodeBlueManagerAuthority");
    expect(wiringSrc).toMatch(
      /from\s+["']\.\/enforcement\/code-blue-manager\.evaluator\.js["']/,
    );
  });

  it("lives outside the enforcement/ isolation boundary (sibling, not child)", () => {
    // If the file were inside enforcement/, the isolation test would fire.
    const enforcementDir = path.join(
      repoRoot,
      "server",
      "lib",
      "authority",
      "enforcement",
      "code-blue-manager.wiring.ts",
    );
    expect(fs.existsSync(enforcementDir)).toBe(false);
  });
});
