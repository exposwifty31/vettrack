import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { sentryVitePlugin } from "@sentry/vite-plugin";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync("./package.json", "utf-8")) as { version: string };

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
  plugins: [react(), ...sentryPlugin],
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
