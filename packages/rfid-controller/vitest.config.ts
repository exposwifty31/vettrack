import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Package-local vitest config. The root vitest `include` (vite.config.ts) is
// `tests/**` + `src/**` at the repo root and does NOT cover `packages/**`, so
// this package owns its own runner (invoked via the root `test:rfid-controller`
// script). `root` is pinned to THIS directory so `tests/**` always resolves to
// the package's own tests regardless of the invoking CWD (running the script
// from the repo root would otherwise sweep the whole app suite). The e2e suite
// self-skips when DATABASE_URL is unset (DB-integration class) — see
// tests/e2e.test.ts.
export default defineConfig({
  root: dirname(fileURLToPath(import.meta.url)),
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    watch: false,
  },
});
