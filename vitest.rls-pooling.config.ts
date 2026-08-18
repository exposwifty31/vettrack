import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The tenant-pooling / RLS invariant suite, excluded from default `pnpm test`
 * (vite.config.ts) because it runs real DDL: CREATE TABLE, ENABLE and FORCE
 * ROW LEVEL SECURITY, CREATE POLICY.
 *
 * It gets its OWN config rather than joining vitest.db-integration.config.ts,
 * so invoking it stays a separate, deliberate act — that runner's documented
 * scope should not silently grow to include schema-altering statements.
 *
 * The suite still self-skips unless DATABASE_URL is real (not the placeholder
 * tests/vitest-setup.ts injects), so this runner is safe to call blind; it will
 * report skipped rather than touch a database nobody chose.
 *
 * Run: DATABASE_URL=... pnpm test:rls-pooling
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
    include: ["tests/tenant-pooling-isolation.integration.test.ts"],
    exclude: ["**/node_modules/**"],
    hookTimeout: 60_000,
    testTimeout: 60_000,
    fileParallelism: false,
  },
});
