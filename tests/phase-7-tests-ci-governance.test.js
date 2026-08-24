import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const repoRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
// users.ts was split into server/routes/users/handlers/*.ts (see the file's
// own TODO(arch) header); concatenate the outer router file with its handler
// modules so this static check still sees the moved route bodies. Mirrors
// equipmentErrorContractSource in phase-5-route-error-contract.test.js.
const usersRouteFile = fs.readFileSync(path.join(repoRoot, "server", "routes", "users.ts"), "utf8");
const usersHandlersDir = path.join(repoRoot, "server", "routes", "users", "handlers");
const usersHandlerSources = fs
  .readdirSync(usersHandlersDir)
  .filter((name) => name.endsWith(".ts"))
  .map((name) => fs.readFileSync(path.join(usersHandlersDir, name), "utf8"))
  .join("\n");
const usersRoute = usersRouteFile + usersHandlerSources;
const roleResolution = fs.readFileSync(path.join(repoRoot, "server", "lib", "role-resolution.ts"), "utf8");
const noHardcodedStringsPath = path.join(repoRoot, "tests", "no-hardcoded-ui-strings.test.js");
const phase4Path = path.join(repoRoot, "tests", "phase-4-i18n-rtl-foundation.test.js");

describe("Phase 7 tests/CI/integrity/governance checks (static)", () => {
  it("CI test script uses vitest (which picks up the hardcoded UI string guard)", () => {
    expect(
      typeof packageJson.scripts?.test === "string" &&
        packageJson.scripts.test.includes("vitest") &&
        fs.existsSync(noHardcodedStringsPath)
    ).toBe(true);
  });

  it("Language and direction guard tests exist", () => {
    expect(fs.existsSync(noHardcodedStringsPath) && fs.existsSync(phase4Path)).toBe(true);
  });

  it("Users route enforces governance guardrails on admin and ownership actions", () => {
    expect(
      usersRoute.includes("reason: \"LAST_ADMIN_DEMOTION_BLOCKED\"") &&
        usersRoute.includes("reason: \"LAST_ADMIN_DELETE_BLOCKED\"") &&
        usersRoute.includes("reason: \"INSUFFICIENT_ROLE\"")
    ).toBe(true);
  });

  it("Role resolution preserves clinic-scoped governance context", () => {
    expect(
      roleResolution.includes("clinicId: string;") &&
        roleResolution.includes("userId?: string;") &&
        roleResolution.includes("source: \"shift\" | \"permanent\"")
    ).toBe(true);
  });
});
