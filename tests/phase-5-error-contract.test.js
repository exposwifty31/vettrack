import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const repoRoot = path.resolve(__dirname, "..");
const accessDenied = fs.readFileSync(path.join(repoRoot, "server", "lib", "access-denied.ts"), "utf8");
const auth = fs.readFileSync(path.join(repoRoot, "server", "middleware", "auth.ts"), "utf8");
const api = fs.readFileSync(path.join(repoRoot, "src", "lib", "api.ts"), "utf8");
const requestCore = fs.readFileSync(path.join(repoRoot, "src", "lib", "request-core.ts"), "utf8");

describe("Phase 5 API error contract checks (static)", () => {
  it("Access denied payload supports code + requestId", () => {
    expect(
      accessDenied.includes("code: \"ACCESS_DENIED\"") && accessDenied.includes("requestId?: string"),
    ).toBe(true);
  });

  it("Auth middleware propagates requestId header", () => {
    expect(
      auth.includes("resolveRequestId(req, res)") && auth.includes("res.setHeader(\"x-request-id\", requestId)"),
    ).toBe(true);
  });

  it("Auth middleware emits standardized API error schema", () => {
    expect(
      auth.includes("buildApiErrorBody") &&
        auth.includes("code: params.code") &&
        auth.includes("requestId: params.requestId"),
    ).toBe(true);
  });

  it("Frontend API client understands structured error payloads with requestId", () => {
    // The client parses requestId onto ApiError so callers/logs can access it.
    // It is intentionally NOT appended to the user-facing message (Phase 10 F2 —
    // a raw requestId GUID in a toast is info disclosure + bad UX), so the
    // contract asserted here is the structural parse, not the display string.
    expect(
      requestCore.includes("export interface ApiErrorPayload") &&
        requestCore.includes("toApiErrorMessage") &&
        requestCore.includes("this.requestId = payload.requestId"),
    ).toBe(true);
  });
});
