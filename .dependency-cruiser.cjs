/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-frontend-to-server",
      severity: "error",
      from: { path: "^src/" },
      to: { path: "^server/" },
    },
    {
      name: "no-server-to-frontend",
      severity: "error",
      from: { path: "^server/" },
      to: { path: "^src/" },
    },
    {
      name: "no-features-to-pages-internals",
      comment: "Features should not import arbitrary page modules during migration",
      severity: "warn",
      from: { path: "^src/features/[^/]+/" },
      to: { path: "^src/pages/[^/]+\\.tsx$", pathNot: "^src/pages/[^/]+/index\\.tsx$" },
    },
    {
      name: "no-route-db-in-new-code",
      comment: "New domain routes must not import db; legacy server/routes/*.ts grandfathered",
      severity: "error",
      from: { path: "^server/routes/domains/" },
      to: { path: "^server/db\\.js$" },
    },
    {
      name: "shared-is-framework-agnostic",
      severity: "error",
      from: { path: "^shared/" },
      to: { path: "^(server|src)/" },
    },
    {
      name: "R1-shared-no-frameworks",
      comment: "src/core and src/shared must stay framework-free (no React, Capacitor, router, ORM, or framework-bound local-path imports)",
      severity: "error",
      from: { path: "^src/(core|shared)/" },
      to: {
        path: "^(src/(app|components|desktop|features|hooks|lib|native|pages)/|@ionic/|@capacitor/|react(/|$)|react-dom(/|$)|wouter(/|$)|dexie(/|$)|drizzle-orm(/|$)|express(/|$))",
      },
    },
    {
      name: "R3-no-cross-shell",
      comment: "Native shell and desktop shell must not import each other",
      severity: "error",
      from: { path: "^src/native/" },
      to: { path: "^src/desktop/" },
    },
    {
      name: "R3-no-cross-shell-inverse",
      comment: "Desktop shell must not import native shell",
      severity: "error",
      from: { path: "^src/desktop/" },
      to: { path: "^src/native/" },
    },
    {
      name: "R5-workers-no-client",
      comment: "Server workers must not import frontend source or React",
      severity: "error",
      from: { path: "^server/(workers|jobs)/" },
      to: { path: "^src/|^(react|react-dom)(/|$)" },
    },
    {
      name: "no-circular",
      severity: "warn",
      from: { pathNot: "^node_modules" },
      to: { circular: true },
    },
    {
      name: "asset-copilot-no-mutation-imports",
      comment:
        "Asset Copilot evidence/resolver/orchestrator must not reach equipment write routes (direct or transitive). Plan: docs/architecture/asset-copilot-implementation-plan.md §3.8",
      severity: "error",
      from: {
        path: "^server/(domain/equipment/(evidence|copilot)/|services/asset-copilot-orchestrator)",
      },
      to: {
        path: "^server/routes/equipment",
      },
    },
  ],
  options: {
    doNotFollow: { path: ["node_modules"] },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
  },
};
