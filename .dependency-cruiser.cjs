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
      name: "no-circular",
      severity: "warn",
      from: { pathNot: "^node_modules" },
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: ["node_modules"] },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
  },
};
