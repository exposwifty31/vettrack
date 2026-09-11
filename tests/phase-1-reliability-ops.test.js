import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const repoRoot = path.resolve(__dirname, "..");
const metrics = fs.readFileSync(path.join(repoRoot, "server", "lib", "metrics.ts"), "utf8");
const queueLib = fs.readFileSync(path.join(repoRoot, "server", "lib", "queue.ts"), "utf8");
const queueRoute = fs.readFileSync(path.join(repoRoot, "server", "routes", "queue.ts"), "utf8");
const worker = fs.readFileSync(path.join(repoRoot, "server", "workers", "notification.worker.main.ts"), "utf8");

describe("Phase 1 reliability/ops checks (static)", () => {
  it("Metrics include persisted state loading/writing", () => {
    expect(
      metrics.includes("METRICS_STATE_FILE") &&
        metrics.includes("loadPersistedMetrics()") &&
        metrics.includes("schedulePersist()"),
    ).toBe(true);
  });

  it("Queue failures are wired into reliability metrics", () => {
    expect(
      queueLib.includes("function markQueueFailure(): void") &&
        queueLib.includes("incrementMetric(\"circuit_breaker_opened\")"),
    ).toBe(true);
  });

  it("Queue route exposes DLQ replay path with structured errors", () => {
    expect(
      queueRoute.includes("router.post(\"/dlq/:jobId/replay\"") &&
        queueRoute.includes("reason: \"QUEUE_DLQ_REPLAY_FAILED\""),
    ).toBe(true);
  });

  it("Worker supports graceful shutdown handlers", () => {
    expect(
      worker.includes("process.on(\"SIGTERM\"") &&
        worker.includes("process.on(\"SIGINT\"") &&
        worker.includes("graceful shutdown complete"),
    ).toBe(true);
  });
});
