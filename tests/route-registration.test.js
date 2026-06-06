import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const repoRoot = path.resolve(__dirname, "..");
const serverIndexPath = path.join(repoRoot, "server", "index.ts");
const routesPath = path.join(repoRoot, "server", "app", "routes.ts");
const source = [
  fs.existsSync(serverIndexPath) ? fs.readFileSync(serverIndexPath, "utf8") : "",
  fs.existsSync(routesPath) ? fs.readFileSync(routesPath, "utf8") : "",
].join("\n");

const requiredPrefixes = [
  "/api/users",
  "/api/equipment",
  "/api/analytics",
  "/api/activity",
  "/api/metrics",
  "/api/folders",
  "/api/stability",
  "/api/alert-acks",
  "/api/rooms",
  "/api/support",
  "/api/push",
  "/api/whatsapp",
  "/api/audit-logs",
  "/api/storage",
  "/api/test",
  "/api/health/ready",
  "/api/containers",
];

describe("Route Registration Smoke Test", () => {
  for (const prefix of requiredPrefixes) {
    it(`Mounted route: ${prefix}`, () => {
      expect(source).toContain(`"${prefix}"`);
    });
  }
});
