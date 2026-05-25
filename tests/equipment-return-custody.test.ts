/**
 * Equipment return — custody atomicity and offline plug-in replay contracts.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { equipmentReturnBodySchema } from "../server/routes/equipment.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const routeSource = fs.readFileSync(path.join(__dirname, "..", "server", "routes", "equipment.ts"), "utf8");
const apiSource = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "api.ts"), "utf8");

describe("equipment return body schema", () => {
  it("accepts offline replay payload with isPluggedIn false", () => {
    const parsed = equipmentReturnBodySchema.safeParse({
      isPluggedIn: false,
      plugInDeadlineMinutes: 30,
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts empty body for legacy callers", () => {
    const parsed = equipmentReturnBodySchema.safeParse({});
    expect(parsed.success).toBe(true);
  });
});

describe("equipment return custody + charge tracking contracts", () => {
  it("rolls back when V1 custody transition cannot apply (version conflict)", () => {
    expect(routeSource).toContain("CUSTODY_RETURN_VERSION_CONFLICT");
    expect(routeSource).toContain('reason: "VERSION_CONFLICT"');
  });

  it("does not emit custody realtime event unless transition applied", () => {
    const returnRouteStart = routeSource.indexOf("// POST /api/equipment/:id/return");
    const returnRouteEnd = routeSource.indexOf("// POST /api/equipment/:id/seen");
    const returnRouteBody = routeSource.slice(returnRouteStart, returnRouteEnd);
    const eventIdx = returnRouteBody.indexOf("EQUIPMENT_CUSTODY_STATE_CHANGED");
    const transitionIdx = returnRouteBody.indexOf("if (transitionCustody)");
    expect(eventIdx).toBeGreaterThan(-1);
    expect(transitionIdx).toBeGreaterThan(-1);
    expect(transitionIdx).toBeLessThan(eventIdx);
  });

  it("offline return replay still carries plug-in payload for server-side record creation", () => {
    expect(apiSource).toContain('syncType: "return_with_charge"');
    expect(apiSource).toContain("requestBody: returnRequest");
    expect(apiSource).toContain("if (response.returnRecord)");
  });

  it("stale client-timestamp idempotent return uses the same JSON envelope as a normal return", () => {
    const returnRouteStart = routeSource.indexOf("// POST /api/equipment/:id/return");
    const returnRouteEnd = routeSource.indexOf("// POST /api/equipment/:id/seen");
    const returnRouteBody = routeSource.slice(returnRouteStart, returnRouteEnd);
    expect(returnRouteBody).toContain("alreadyReturned = true");

    const branchStart = returnRouteBody.indexOf("if (alreadyReturned)");
    expect(branchStart).toBeGreaterThan(-1);
    const afterBranch = returnRouteBody.slice(branchStart);
    const branchEnd = afterBranch.indexOf("const u = updated");
    expect(branchEnd).toBeGreaterThan(-1);
    const alreadyReturnedBranch = afterBranch.slice(0, branchEnd);

    expect(alreadyReturnedBranch).toMatch(
      /return res\.json\(\s*\{[\s\S]*equipment:\s*updated/,
    );
    expect(alreadyReturnedBranch).toContain('undoToken: ""');
    expect(alreadyReturnedBranch).toContain("returnRecord: null");
    expect(alreadyReturnedBranch).not.toMatch(/res\.json\(\s*updated\s*\)/);
  });
});
