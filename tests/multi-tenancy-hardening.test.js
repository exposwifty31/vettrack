import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const repoRoot = path.resolve(__dirname, "..");
const tenantMiddlewarePath = path.join(repoRoot, "server", "middleware", "tenant-context.ts");
const authMiddlewarePath = path.join(repoRoot, "server", "middleware", "auth.ts");
const routesDir = path.join(repoRoot, "server", "routes");

const tenantMiddleware = fs.readFileSync(tenantMiddlewarePath, "utf8");
const authMiddleware = fs.readFileSync(authMiddlewarePath, "utf8");

const routeFiles = fs
  .readdirSync(routesDir)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => path.join(routesDir, f));

// server/routes/code-blue.ts was split into a thin router (registrations +
// middleware only) plus per-handler modules under code-blue/handlers/
// (mechanical file split, TODO(arch) formerly in code-blue.ts). The scan
// above is intentionally non-recursive and would otherwise silently drop
// coverage: code-blue.ts itself no longer contains any inline `.from(...)`
// query, so it stops matching `dbRouteFiles` below, while the handler files
// that DO now hold those queries live one directory deeper and are never
// discovered. Add them explicitly so the same clinicId invariant keeps
// being checked against the code that actually runs it.
const codeBlueHandlersDir = path.join(routesDir, "code-blue", "handlers");
if (fs.existsSync(codeBlueHandlersDir)) {
  for (const f of fs.readdirSync(codeBlueHandlersDir)) {
    if (f.endsWith(".ts")) routeFiles.push(path.join(codeBlueHandlersDir, f));
  }
}

// Routes that intentionally operate across all tenants (no clinicId scoping):
//   webhooks.ts — Clerk webhook handler uses clerkId to find users across clinics;
//                 it is unauthenticated and must not be tenant-scoped.
const CROSS_TENANT_ROUTES = new Set(["webhooks.ts"]);

const dbRouteFiles = routeFiles.filter((filePath) => {
  if (CROSS_TENANT_ROUTES.has(path.basename(filePath))) return false;
  const src = fs.readFileSync(filePath, "utf8");
  return (
    src.includes("from(equipment)") ||
    src.includes("from(users)") ||
    src.includes("from(folders)") ||
    src.includes("from(rooms)") ||
    src.includes("from(hospitalizations)") ||
    src.includes("from(animals)")
  );
});

describe("Multi-Tenancy Hardening Smoke Test", () => {
  it("Tenant middleware sets clinic when inferrable and always continues", () => {
    expect(
      tenantMiddleware.includes("req.clinicId = clinicId") &&
        tenantMiddleware.includes("Best-effort clinic hint")
    ).toBeTruthy();
  });

  it("Auth middleware attaches req.clinicId", () => {
    expect(authMiddleware).toContain("req.clinicId = result.user.clinicId");
  });

  for (const filePath of dbRouteFiles) {
    const src = fs.readFileSync(filePath, "utf8");
    const rel = path.relative(repoRoot, filePath).replace(/\\/g, "/");
    it(`Route references clinic context: ${rel}`, () => {
      expect(src).toContain("req.clinicId");
    });
  }

  it("Equipment queries are clinic-scoped", () => {
    const equipmentRoute = fs.readFileSync(path.join(routesDir, "equipment.ts"), "utf8");
    expect(equipmentRoute).toContain("eq(equipment.clinicId, clinicId)");
  });

  it("User queries are clinic-scoped", () => {
    const usersRoute = fs.readFileSync(path.join(routesDir, "users.ts"), "utf8");
    expect(usersRoute).toContain("eq(users.clinicId, clinicId)");
  });
});
