/**
 * T22 — unify the management-surface denial pattern.
 *
 * Before this fix, a non-admin/vet hitting an admin/management surface saw one
 * of (at least) four divergent outcomes depending on which page they landed on:
 *   1. Silent redirect       — ManagementGuard (`/dashboard`, `/admin/integrations`, …)
 *   2. Hand-rolled explicit denial with page-specific copy — admin.tsx, audit-log.tsx
 *   3. Renders anyway (a leak) — `/procurement`, `/analytics` had NO gate at all
 *   4. Blank screen (`return null`) — AdminAssetTypesPage, AdminDocksPage,
 *      OperationalMetricsDashboardPage
 *   (plus a wrong-i18n-key bug in admin-shifts.tsx that rendered "Cancel" as the
 *   denial message)
 *
 * Every one of those call sites now renders the ONE shared `ManagementAccessDenied`
 * component. This is a source-text (structural) test — it verifies the wiring
 * directly against the files that would regress if someone re-introduced any of
 * the old patterns, without needing to stand up the full auth/query/router stack
 * for every single page.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

describe("routes.tsx — the procurement/analytics render-anyway leak is closed", () => {
  const routes = read("src/app/routes.tsx");

  it("/procurement is gated by ManagementGuard (previously ungated)", () => {
    const line = routes.split("\n").find((l) => l.includes('path="/procurement"'));
    expect(line, "expected a /procurement route").toBeTruthy();
    expect(line).toContain("<ManagementGuard>");
    expect(line).toContain("<AuthGuard>");
    expect(line).toContain("<WebOnlyGuard>");
  });

  it("/analytics is gated by ManagementGuard (previously ungated) — matches its own WEB_MANAGEMENT_NAV listing", () => {
    const line = routes.split("\n").find((l) => l.includes('path="/analytics"'));
    expect(line, "expected an /analytics route").toBeTruthy();
    expect(line).toContain("<ManagementGuard>");
  });

  it("every /admin/* console route and /dashboard still route through ManagementGuard (no regression)", () => {
    const consoleRoutes = [
      "/dashboard",
      "/admin/integrations",
      "/admin/webhooks",
      "/admin/notifications",
      "/admin/rfid-readers",
      "/admin/governance",
      "/admin/audit-log",
      "/admin/inventory",
      "/admin/people",
      "/admin/displays",
      "/ops/health",
    ];
    for (const p of consoleRoutes) {
      const line = routes.split("\n").find((l) => l.includes(`path="${p}"`));
      expect(line, `expected a route for ${p}`).toBeTruthy();
      expect(line, `${p} should stay ManagementGuard-gated`).toContain("<ManagementGuard>");
    }
  });
});

describe("ManagementGuard — no more silent redirect", () => {
  const src = read("src/desktop/management/ManagementGuard.tsx");

  it("no longer imports or renders wouter's <Redirect>", () => {
    expect(src).not.toMatch(/from ["']wouter["']/);
    expect(src).not.toContain("<Redirect");
  });

  it("renders the shared ManagementAccessDenied state", () => {
    expect(src).toContain("<ManagementAccessDenied");
  });
});

describe("Every management-surface denial site renders the ONE shared component", () => {
  const sites: Array<{ file: string; note: string }> = [
    { file: "src/pages/admin.tsx", note: "was hand-rolled Shield+title+desc+button JSX" },
    { file: "src/pages/admin-shifts.tsx", note: "was a wrong-i18n-key bug (rendered t.adminPage.cancel)" },
    { file: "src/pages/audit-log.tsx", note: "was hand-rolled Shield+title+desc+button JSX" },
    { file: "src/pages/shift-leaderboard.tsx", note: "was a bare text line, no icon/CTA" },
    { file: "src/pages/AdminAssetTypesPage.tsx", note: "was a blank `return null`" },
    { file: "src/pages/AdminDocksPage.tsx", note: "was a blank `return null`" },
    { file: "src/pages/OperationalMetricsDashboardPage.tsx", note: "was a blank `return null`" },
  ];

  for (const { file, note } of sites) {
    it(`${file} uses <ManagementAccessDenied /> (${note})`, () => {
      const src = read(file);
      expect(src).toContain("ManagementAccessDenied");
      expect(src).toContain("<ManagementAccessDenied");
    });
  }

  it("admin-shifts.tsx no longer renders the wrong-key 'Cancel' text as its denial message", () => {
    const src = read("src/pages/admin-shifts.tsx");
    expect(src).not.toContain("{t.adminPage.cancel}");
  });

  it("the three former blank-screen pages no longer bail with a bare `return null` on role mismatch", () => {
    for (const file of [
      "src/pages/AdminAssetTypesPage.tsx",
      "src/pages/AdminDocksPage.tsx",
      "src/pages/OperationalMetricsDashboardPage.tsx",
    ]) {
      const src = read(file);
      // The 501-not-yet-implemented branches further down still legitimately
      // `return null`; only the role-gate branch (immediately after useAuth)
      // must no longer be a bare null.
      expect(src).not.toMatch(/role !== "admin"\) return null;/);
    }
  });
});
