// tests/code-blue-page.test.js — updated for new session architecture
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const codeBluePage = fs.readFileSync(path.join(__dirname, "..", "src", "pages", "code-blue.tsx"), "utf8");
const layout = fs.readFileSync(path.join(__dirname, "..", "src", "components", "layout.tsx"), "utf8");
const routesSource = fs.readFileSync(path.join(__dirname, "..", "src", "app", "routes.tsx"), "utf8");

describe("Code Blue page structure tests", () => {
  it("Page uses useCodeBlueSession hook", () => {
    expect(codeBluePage).toContain("useCodeBlueSession");
  });

  it("Header contains CODE BLUE label with alert icon", () => {
    expect(codeBluePage.includes("CODE BLUE") && codeBluePage.includes("AlertTriangle")).toBe(true);
  });

  it("Elapsed timer uses formatElapsed helper (not raw ISO timestamps)", () => {
    expect(codeBluePage).toContain("function formatElapsed");
  });

  it("Manager designation is required before session starts", () => {
    expect(codeBluePage).toContain("managerUserId");
    expect(codeBluePage).toContain("managerUserName");
  });

  it("manager can end event without CPR time gate", () => {
    expect(codeBluePage).toContain("endEventChooseOutcome");
    expect(codeBluePage).not.toMatch(/15\s*\*\s*60\s*\*\s*1000/);
  });

  it("Code Blue nav is role-gated via canAccessCodeBlue", () => {
    expect(layout).toContain("canAccessCodeBlue");
    expect(layout).toContain("CANONICAL_HREFS.emergencyEquipmentLog");
  });

  it("Code Blue route is registered behind AuthGuard", () => {
    expect(
      routesSource.includes('const CodeBluePage = lazy(() => import("@/pages/code-blue"))') &&
        routesSource.includes('"/code-blue"') &&
        routesSource.includes("AuthGuard"),
    ).toBe(true);
  });
});
