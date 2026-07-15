import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { sentryVitePlugin } from "@sentry/vite-plugin";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync("./package.json", "utf-8")) as { version: string };

/** Merge Vite .env* files into process.env. */
function applyViteEnvFiles(mode: string): void {
  const env = loadEnv(mode, process.cwd(), "");
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

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
      const vitePilotMode = false;
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

export default defineConfig(({ mode }) => {
  applyViteEnvFiles(mode);
  const effectiveVitePilotMode = false;
  const VT_BUILD_TAG = `${version}-${Date.now().toString(36)}`;

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

  return {
    plugins: [react(), swBuildTagTemplate(VT_BUILD_TAG), deployBuildInfo(version, VT_BUILD_TAG), ...sentryPlugin],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "@assets": path.resolve(__dirname, "./docs/archive/2026/attached_assets"),
      },
    },
    server: {
      port: 5000,
      strictPort: true,
      host: true,
      allowedHosts: true,
      proxy: {
        "/api": {
          target: "http://127.0.0.1:3001",
          changeOrigin: true,
        },
      },
    },
    define: {
      __APP_VERSION__: JSON.stringify(version),
      __VT_BUILD_TAG__: JSON.stringify(VT_BUILD_TAG),
      "import.meta.env.VITE_PILOT_MODE": JSON.stringify(effectiveVitePilotMode ? "true" : "false"),
    },
    optimizeDeps: {
      include: ["recharts"],
    },
    build: {
      outDir: "dist/public",
      // Hidden sourcemaps are only useful where they're uploaded to Sentry (the deploy
      // build sets SENTRY_AUTH_TOKEN). Generating the (large) .map files in CI compile-
      // checks / local builds just to throw them away is wasted time.
      sourcemap: process.env.SENTRY_AUTH_TOKEN ? "hidden" : false,
      rollupOptions: {
        output: {
          // Split ONLY the eager app-shell vendors into long-lived, cacheable chunks.
          // Do NOT name lazy-only libs (recharts, jspdf, xlsx, html2canvas, @clerk/clerk-js)
          // here — an explicit manualChunks entry hoists them into the initial graph and
          // defeats their lazy route / dynamic-import splitting (they belong in the lazy
          // chunk of the page that dynamically imports them).
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "vendor-react";
            if (id.includes("@clerk/clerk-react")) return "vendor-clerk";
            if (id.includes("@radix-ui")) return "vendor-radix";
            if (id.includes("@tanstack")) return "vendor-query";
            return undefined;
          },
        },
      },
    },
    test: {
      environment: "node",
      setupFiles: ["./tests/vitest-setup.ts"],
      include: ["tests/**/*.test.{ts,tsx,js}", "src/**/*.test.{tsx,ts}"],
      exclude: [
        "**/node_modules/**",
        "tests/restock.service.test.ts",
        "tests/migrations/**",
        "tests/phase-2-3-medication-package-integration.test.ts",
        "tests/equipment-operational-state.integration.test.ts",
        "tests/shift-chat-window.integration.test.ts",
        "tests/charge-alert-worker.test.js",
        "tests/code-blue-mode-equipment.test.js",
        "tests/equipment-scan-e2e.test.js",
        "tests/expiry-api.test.js",
        "tests/expiry-check-worker.test.js",
        "tests/returns-api.test.js",
      ],
    },
  };
});
