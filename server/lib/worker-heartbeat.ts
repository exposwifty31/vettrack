import { getRedis } from "./redis.js";

export const WORKER_HEARTBEAT_KEY = "vettrack:worker:heartbeat";
export const WORKER_HEARTBEAT_TTL_SEC = 120;
export const WORKER_HEARTBEAT_INTERVAL_MS = 30_000;

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

/** Refresh Redis heartbeat for /api/health `worker` check (notification + BullMQ runtimes). */
export function startWorkerHeartbeat(source = "worker"): void {
  if (heartbeatTimer) return;

  const tick = async () => {
    const redis = await getRedis();
    if (!redis) return;
    await redis.set(WORKER_HEARTBEAT_KEY, Date.now().toString(), "EX", WORKER_HEARTBEAT_TTL_SEC);
  };

  void tick().catch((err) => {
    console.error(`[${source}] heartbeat tick failed`, err);
  });

  heartbeatTimer = setInterval(() => {
    void tick().catch((err) => {
      console.error(`[${source}] heartbeat tick failed`, err);
    });
  }, WORKER_HEARTBEAT_INTERVAL_MS);
}

export function stopWorkerHeartbeatForTests(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}
