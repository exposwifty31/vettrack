import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const repoRoot = path.resolve(__dirname, "..");
const redis = fs.readFileSync(path.join(repoRoot, "server", "lib", "redis.ts"), "utf8");
const queue = fs.readFileSync(path.join(repoRoot, "server", "lib", "queue.ts"), "utf8");
const taskNotification = fs.readFileSync(path.join(repoRoot, "server", "lib", "task-notification.ts"), "utf8");
const recall = fs.readFileSync(path.join(repoRoot, "server", "services", "task-recall.service.ts"), "utf8");
const worker = fs.readFileSync(path.join(repoRoot, "server", "workers", "notification.worker.main.ts"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const envExample = fs.readFileSync(path.join(repoRoot, ".env.example"), "utf8");

describe("Phase 3.3.5 Production hardening (static checks)", () => {
  it("server/lib/redis.ts with lazy client + safe reads", () => {
    expect(
      redis.includes("getRedis") && redis.includes("REDIS_URL") && redis.includes("safeRedisGet") && redis.includes("REDIS_DISABLED")
    ).toBe(true);
  });

  it("Redis rate limit helper for queue", () => {
    expect(redis.includes("incrementRateLimit")).toBe(true);
  });

  it("BullMQ queue for notifications", () => {
    expect(queue.includes("bullmq") && queue.includes("Queue")).toBe(true);
  });

  it("Job retries with backoff", () => {
    expect(queue.includes("attempts") && queue.includes("backoff")).toBe(true);
  });

  it("Enqueue is API-safe when Redis missing", () => {
    expect(
      queue.includes("enqueueNotificationJob") &&
        queue.includes("droppedNoRedis") &&
        queue.includes("QUEUE_DISABLED_NO_REDIS") &&
        queue.includes("QUEUE_JOB_ENQUEUED")
    ).toBe(true);
  });

  it("Task notifications enqueue from API path; worker calls dispatchTaskNotificationSync", () => {
    expect(
      taskNotification.includes("enqueueNotificationJob") &&
        taskNotification.includes("dispatchTaskNotificationSync") &&
        taskNotification.includes("await enqueueNotificationJob") &&
        taskNotification.includes("NOTIFICATION_SENT")
    ).toBe(true);
  });

  it("Task recall uses Redis cache only; no push in service", () => {
    expect(
      recall.includes("task_dashboard:") && !recall.includes("sendPushToUser") && recall.includes("safeRedisSetex")
    ).toBe(true);
  });

  it("Notification worker processes jobs with observability hooks", () => {
    expect(
      worker.includes("Worker") &&
        worker.includes("scan_overdue_reminders") &&
        worker.includes("QUEUE_JOB_STARTED") &&
        worker.includes("QUEUE_JOB_COMPLETED") &&
        worker.includes("QUEUE_JOB_FAILED") &&
        worker.includes("NOTIFICATION_WORKER_STARTED") &&
        worker.includes("WORKER_DISABLED_NO_REDIS")
    ).toBe(true);
  });

  it("package.json lists ioredis + bullmq", () => {
    expect(pkg.dependencies?.ioredis && pkg.dependencies?.bullmq).toBeTruthy();
  });

  it("worker:notifications npm script", () => {
    expect(pkg.scripts?.["worker:notifications"]?.includes("notification.worker")).toBe(true);
  });

  it(".env.example documents REDIS_URL", () => {
    expect(envExample.includes("REDIS_URL")).toBe(true);
  });
});
