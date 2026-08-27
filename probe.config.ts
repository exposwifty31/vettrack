import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: ["__probe-p06.spec.ts"],
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  timeout: 900_000,
  globalTimeout: 1_800_000,
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
