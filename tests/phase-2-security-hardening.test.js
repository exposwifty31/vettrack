import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const repoRoot = path.resolve(__dirname, "..");
const audit = fs.readFileSync(path.join(repoRoot, "server", "lib", "audit.ts"), "utf8");
const roleResolution = fs.readFileSync(path.join(repoRoot, "server", "lib", "role-resolution.ts"), "utf8");
// users.ts was split into server/routes/users/handlers/*.ts (see the file's
// own TODO(arch) header); concatenate the outer router file with its handler
// modules so this static check still sees the moved route bodies. Mirrors the
// equipmentErrorContractSource construction in phase-5-route-error-contract.test.js.
const usersRouteFile = fs.readFileSync(path.join(repoRoot, "server", "routes", "users.ts"), "utf8");
const usersHandlersDir = path.join(repoRoot, "server", "routes", "users", "handlers");
const usersHandlerSources = fs
  .readdirSync(usersHandlersDir)
  .filter((name) => name.endsWith(".ts"))
  .map((name) => fs.readFileSync(path.join(usersHandlersDir, name), "utf8"))
  .join("\n");
const usersRoute = usersRouteFile + usersHandlerSources;
const auth = fs.readFileSync(path.join(repoRoot, "server", "middleware", "auth.ts"), "utf8");

describe("Phase 2 security hardening checks (static)", () => {
  it("Audit action type includes users_backfilled_from_clerk", () => {
    expect(audit).toContain("| \"users_backfilled_from_clerk\"");
  });

  it("Role resolution supports canonical userId lookup", () => {
    expect(
      roleResolution.includes("userId?: string;") &&
        roleResolution.includes("where(and(eq(users.id, input.userId.trim()), eq(users.clinicId, input.clinicId)))"),
    ).toBe(true);
  });

  it("Users sync relies on authoritative auth context identity fields", () => {
    expect(
      usersRoute.includes("const canonicalClerkId = req.authUser!.clerkId;") &&
        usersRoute.includes("const canonicalEmail = req.authUser!.email;") &&
        usersRoute.includes("const canonicalName = req.authUser!.name;") &&
        usersRoute.includes("source: \"authoritative_auth_context\""),
    ).toBe(true);
  });

  it("Users sync blocks request/auth identity mismatches", () => {
    expect(usersRoute).toContain(
      "if (clerkId !== canonicalClerkId || email.toLowerCase() !== canonicalEmail.toLowerCase())",
    );
  });

  it("Role resolution consumers pass canonical user id", () => {
    expect(
      auth.includes("userId: req.authUser.id,") && usersRoute.includes("userId: req.authUser.id,"),
    ).toBe(true);
  });
});
