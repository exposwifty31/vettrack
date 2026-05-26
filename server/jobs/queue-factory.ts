import { Queue, type JobsOptions } from "bullmq";
import { createRedisConnection, getRedisUrl } from "../lib/redis.js";

export type QueueFactoryConfig = {
  queueName: string;
  defaultJobOptions?: JobsOptions;
  /** Log prefix for queue error events (e.g. inventory-deduction-queue). */
  logLabel?: string;
};

const queuesByName = new Map<string, Queue>();
const initFailedQueueNames = new Set<string>();

function queueErrorLabel(config: QueueFactoryConfig): string {
  return config.logLabel ?? `${config.queueName}-queue`;
}

/**
 * Returns a cached BullMQ Queue for `queueName`, or throws when Redis is unavailable.
 * Each call uses a dedicated Redis connection (BullMQ producer requirement).
 */
export async function getOrCreateQueue<T = unknown>(
  config: QueueFactoryConfig,
): Promise<Queue<T>> {
  const existing = queuesByName.get(config.queueName);
  if (existing) {
    return existing as Queue<T>;
  }

  if (initFailedQueueNames.has(config.queueName)) {
    throw new Error(`${config.queueName} queue unavailable`);
  }

  if (!getRedisUrl()) {
    initFailedQueueNames.add(config.queueName);
    throw new Error(`${config.queueName} queue disabled: REDIS_URL missing`);
  }

  const connection = await createRedisConnection();
  if (!connection) {
    throw new Error(`${config.queueName} queue unavailable: Redis connection failed`);
  }

  const queue = new Queue<T>(config.queueName, {
    connection,
    defaultJobOptions: config.defaultJobOptions,
  });

  const label = queueErrorLabel(config);
  queue.on("error", (error) => {
    console.error(`[${label}] queue error`, { message: error.message });
  });

  queuesByName.set(config.queueName, queue as Queue);
  return queue;
}

/** Test-only: clear cached queues and failure flags. */
export function resetQueueFactoryForTests(): void {
  queuesByName.clear();
  initFailedQueueNames.clear();
}
