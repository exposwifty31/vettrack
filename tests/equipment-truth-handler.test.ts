import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("GET /equipment/:id/truth handler contract", () => {
  const src = readFileSync("server/routes/equipment/handlers/get-equipment-truth.ts", "utf8");

  it("uses the shared equipment route error envelope for unauthorized and missing equipment", () => {
    expect(src).toContain("resolveRequestId(res, req.headers[\"x-request-id\"])");
    expect(src).toContain('code: "UNAUTHORIZED"');
    expect(src).toContain('reason: "EQUIPMENT_NOT_FOUND"');
    expect(src).toContain("requestId");
  });

  it("does not call apiError with the removed legacy Express signature", () => {
    expect(src).not.toContain("apiError(req, res");
  });
});
