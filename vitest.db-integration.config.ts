import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * DB integration suites excluded from default `pnpm test` (vite.config.ts).
 * Run: DATABASE_URL=... pnpm exec vitest run --config vitest.db-integration.config.ts
 *
 * This list is not optional garnish — it is the only thing that runs these files.
 * A suite that leaves `pnpm test` and is not named here is executed by nothing at
 * all, which is how 18 of the entries below spent months uncovered while this
 * config sat in the tree naming five. `tests/excluded-suite-coverage.test.ts`
 * now fails when any excluded suite has no runner, and when a runner is not
 * invoked by ci.yml.
 *
 * `.test.js` scripts under `tests/` are NOT vitest suites and cannot go here —
 * they declare no `describe`/`it` and run as standalone tsx programs. They are
 * covered by `scripts/ci/db-script-tests.mjs`.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@assets": path.resolve(__dirname, "./docs/archive/2026/attached_assets"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/vitest-setup.ts"],
    include: [
      "tests/equipment-operational-state.integration.test.ts",
      "tests/seed-reviewer-demo.integration.test.ts",
      "tests/doctor-shift-gate.integration.test.ts",
      "tests/push-endpoint-cross-clinic.integration.test.ts",
      "tests/push-subscription-race.integration.test.ts",

      // Added 2026-09-01 (#221 left these excluded with no runner). Measured
      // green together against a freshly migrated database: 189 assertions.
      "tests/dock-return-anchor.integration.test.ts",
      "tests/docking-anchor-contradictions.integration.test.ts",
      "tests/docking-citizen-anchor.integration.test.ts",
      "tests/docking-home-assign.integration.test.ts",
      "tests/docking-route.integration.test.ts",
      "tests/equipment-anchor.service.integration.test.ts",
      "tests/equipment-coordinator.integration.test.ts",
      "tests/equipment-missing-alert.integration.test.ts",
      "tests/reconciliation-buckets.integration.test.ts",
      "tests/room-last-swept.integration.test.ts",
      "tests/room-readiness.integration.test.ts",
      "tests/room-sweep.integration.test.ts",
      "tests/senior-doctor-eligible.integration.test.ts",
      "tests/shift-handover-generator.test.ts",
      "tests/shift-handover-observed.test.ts",
      "tests/shift-handover-patient-worklist.test.ts",
      "tests/shift-handover-surface.test.tsx",
      "tests/sweep-escalation.test.ts",
    ],
    exclude: ["**/node_modules/**"],
    hookTimeout: 60_000,
    testTimeout: 60_000,
    fileParallelism: false,
  },
});
