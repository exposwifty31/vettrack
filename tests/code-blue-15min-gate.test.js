/**
 * Code Blue end-session — equipment-focused product no longer enforces a
 * 15-minute CPR minimum. Manager-only + vet role checks remain.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const routes = fs.readFileSync(path.join(root, "server/routes/code-blue.ts"), "utf8");

const endHandlerStart = routes.indexOf("sessions/:id/end");
const endHandlerBlock = endHandlerStart !== -1 ? routes.slice(endHandlerStart) : "";

describe("Code Blue end session — no CPR duration gate", () => {
  it("does not reject with TOO_EARLY for short sessions", () => {
    expect(endHandlerBlock).not.toContain("TOO_EARLY");
    expect(endHandlerBlock).not.toMatch(/FIFTEEN_MINUTES_MS|15\s*\*\s*60\s*\*\s*1000/);
  });

  it("retains MANAGER_ONLY enforcement", () => {
    expect(endHandlerBlock).toContain("MANAGER_ONLY");
  });

  it("retains NO_VET_MANAGER enforcement", () => {
    expect(endHandlerBlock).toContain("NO_VET_MANAGER");
  });
});
