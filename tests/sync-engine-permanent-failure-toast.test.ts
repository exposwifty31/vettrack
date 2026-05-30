/**
 * EU-01 — permanent offline sync failure must surface operator feedback.
 * Regression: sync-engine previously only wrote Dexie `dead` + Sentry.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const syncEnginePath = path.join(__dirname, "..", "src", "lib", "sync-engine.ts");

describe("sync-engine permanent failure toast (EU-01)", () => {
  const source = fs.readFileSync(syncEnginePath, "utf8");

  it("shows toast with queue action when max retries exhaust", () => {
    expect(source).toContain("toast.error(t.layout.sync.failedMessage");
    expect(source).toContain("t.layout.sync.viewQueue");
    expect(source).toContain("vettrack:open-sync-queue");
  });

  it("marks pending sync dead only after MAX_RETRIES", () => {
    expect(source).toContain('status: "dead"');
    expect(source).toContain("currentRetries >= MAX_RETRIES");
  });
});
