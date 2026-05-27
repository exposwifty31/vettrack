import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * CI / local ops integration gate — runs DB-backed equipment operational state tests.
 * Standalone config (not merged with vite.config.ts) so default vitest excludes do not apply.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@assets": path.resolve(__dirname, "./attached_assets"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/vitest-setup.ts"],
    include: [
      "tests/equipment-operational-state.integration.test.ts",
      "tests/equipment-waitlist.integration.test.ts",
    ],
    exclude: ["**/node_modules/**"],
    hookTimeout: 30_000,
    testTimeout: 15_000,
    fileParallelism: false,
  },
});
