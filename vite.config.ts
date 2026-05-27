import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { resolveEffectiveVitePilotMode } from "./shared/effective-pilot-mode.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const effectiveVitePilotMode = resolveEffectiveVitePilotMode();
if (process.env.VITE_PILOT_MODE === "true" && !effectiveVitePilotMode) {
  console.warn(
    "[vite] VITE_PILOT_MODE=true is set but ignored for this mainline build. " +
      "Remove VITE_PILOT_MODE from Railway or set ALLOW_EQUIPMENT_PILOT_MODE=true only on dedicated equipment-pilot hosts.",
  );
}
const { version } = JSON.parse(readFileSync("./package.json", "utf-8")) as { version: string };

// Phase 9 PR 9.1 — single source-of-truth build tag.
// One value flows into the client bundle (via `define`) and into public/sw.js
// (via the swBuildTagTemplate plugin below), so the SW and the loaded bundle
// can compare tags deterministically.
const VT_BUILD_TAG = `${version}-${Date.now().toString(36)}`;

function swBuildTagTemplate(buildTag: string): Plugin {
  const PLACEHOLDER = "__VT_BUILD_TAG__";
  let outDir = "dist/public";
  return {
    name: "vt-sw-build-tag-template",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const swPath = path.resolve(outDir, "sw.js");
      if (!existsSync(swPath)) return;
      const original = readFileSync(swPath, "utf8");
      if (!original.includes(PLACEHOLDER)) return;
      writeFileSync(swPath, original.split(PLACEHOLDER).join(buildTag), "utf8");
    },
  };
}

/** Written to dist/public/build-info.json — consumed by GET /api/version. */
function deployBuildInfo(appVersion: string, buildTag: string): Plugin {
  let outDir = "dist/public";
  return {
    name: "vt-deploy-build-info",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const vitePilotMode = resolveEffectiveVitePilotMode();
      const gitCommit =
        process.env.RAILWAY_GIT_COMMIT_SHA?.trim() ||
        process.env.GITHUB_SHA?.trim() ||
        process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
        null;
      const payload = {
        appVersion,
        buildTag,
        vitePilotMode,
        builtAt: new Date().toISOString(),
        gitCommit,
      };
      writeFileSync(path.resolve(outDir, "build-info.json"), JSON.stringify(payload, null, 2), "utf8");
    },
  };
}

const sentryPlugin =
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
    ? [
        sentryVitePlugin({
          org: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT,
          authToken: process.env.SENTRY_AUTH_TOKEN,
        }),
      ]
    : [];

export default defineConfig({
  plugins: [react(), swBuildTagTemplate(VT_BUILD_TAG), deployBuildInfo(version, VT_BUILD_TAG), ...sentryPlugin],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@assets": path.resolve(__dirname, "./attached_assets"),
    },
  },
  server: {
    port: 5000,
    strictPort: true,
    host: true,
    allowedHosts: true,
    proxy: {
      "/api": {
        // Use IPv4 loopback to avoid Windows localhost -> ::1 proxy failures.
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
      },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __VT_BUILD_TAG__: JSON.stringify(VT_BUILD_TAG),
    // Override Railway VITE_PILOT_MODE service var on mainline builds (see shared/effective-pilot-mode.ts).
    "import.meta.env.VITE_PILOT_MODE": JSON.stringify(effectiveVitePilotMode ? "true" : "false"),
  },
  optimizeDeps: {
    include: ["recharts"],
  },
  build: {
    outDir: "dist/public",
    sourcemap: "hidden",
    rollupOptions: {
      output: {
        manualChunks: {
          // Heavy data libraries — only needed on analytics / billing / forecast pages
          "vendor-charts": ["recharts"],
          "vendor-export": ["jspdf", "xlsx"],
          // React core — stable across all chunks, cached aggressively
          "vendor-react": ["react", "react-dom"],
          // Animation — only a few pages use framer-motion
          "vendor-motion": ["framer-motion"],
        },
      },
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/vitest-setup.ts"],
    include: ["tests/**/*.test.{ts,js}"],
    exclude: [
      "**/node_modules/**",
      // DB integration tests — require DATABASE_URL + applied migrations
      "tests/restock.service.test.ts",
      "tests/migrations/**",
      "tests/phase-2-3-medication-package-integration.test.ts",
      // DB integration tests — require DATABASE_URL + applied migrations + isolated test clinic
      "tests/equipment-operational-state.integration.test.ts",
      // Live-server integration tests — require dev server running on :3001
      "tests/charge-alert-worker.test.js",
      "tests/code-blue-mode-equipment.test.js",
      "tests/equipment-scan-e2e.test.js",
      "tests/expiry-api.test.js",
      "tests/expiry-check-worker.test.js",
      "tests/returns-api.test.js",
    ],
  },
});
