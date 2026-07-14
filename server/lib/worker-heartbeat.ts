import { getRedis } from "./redis.js";

const WORKER_HEARTBEAT_KEY = "vettrack:worker:heartbeat";
const WORKER_HEARTBEAT_TTL_SEC = 120;
const WORKER_HEARTBEAT_INTERVAL_MS = 30_000;

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
  // Never let the heartbeat hold the event loop open (clean process/test exit).
  (heartbeatTimer as { unref?: () => void })?.unref?.();
}

/** Clear the heartbeat interval. Called by `closeJobRuntime`; safe to call twice. */
export function stopWorkerHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}
