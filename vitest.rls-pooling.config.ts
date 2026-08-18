import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The tenant-pooling / RLS breakage probes, excluded from default `pnpm test`
 * (vite.config.ts) because they run real DDL: CREATE TABLE, ENABLE and FORCE
 * ROW LEVEL SECURITY, CREATE POLICY.
 *
 * Their own config rather than joining vitest.db-integration.config.ts, so
 * invoking them stays a separate, deliberate act — that runner's documented
 * scope should not silently grow to include schema-altering statements.
 *
 * This runner is NOT safe to call blind, and it does not try to be. The suite
 * requires TWO explicit opt-ins and reads `RLS_PROBE_DATABASE_URL` INSTEAD of
 * `DATABASE_URL`, with no fallback, so a developer who happens to have staging
 * configured cannot reach it by omission:
 *
 *   RLS_POOLING_PROBE=1 \
 *   RLS_PROBE_DATABASE_URL=postgres://.../a_throwaway_db \
 *   pnpm test:rls-pooling
 *
 * Point it at a database you are willing to lose. It creates and drops
 * `zz_tenant_pooling_probe` and alters that table's row-security settings.
 */export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@assets": path.resolve(__dirname, "./docs/archive/2026/attached_assets"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/vitest-setup.ts"],
    include: ["tests/tenant-pooling-isolation.integration.test.ts"],
    exclude: ["**/node_modules/**"],
    hookTimeout: 60_000,
    testTimeout: 60_000,
    fileParallelism: false,
  },
});
