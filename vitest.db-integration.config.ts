import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * DB integration suites excluded from default `pnpm test` (vite.config.ts).
 * Run: DATABASE_URL=... pnpm exec vitest run --config vitest.db-integration.config.ts
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
    include: ["tests/equipment-operational-state.integration.test.ts"],
    exclude: ["**/node_modules/**"],
    hookTimeout: 60_000,
    testTimeout: 60_000,
    fileParallelism: false,
  },
});
