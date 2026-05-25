import type { JobsOptions } from "bullmq";

/** BullMQ job context passed to handlers when the runtime is active (Phase 1b+). */
export type JobContext = {
  clinicId?: string;
  jobId: string;
  attempt: number;
};

/**
 * Static BullMQ `job.name` values used by API-process workers.
 * Must match existing Redis job names — do not rename without a migration window.
 */
export type StaticJobKind =
  | "inventory-deduction"
  | "check-plug"
  | "admission-fanout"
  | "task-ownership-backfill"
  | "stale-task-ownership-sweep"
  | "check-expiry"
  | "sweep-stale-checkins";

/** Enqueue-only kind for integration sync (dynamic BullMQ `job.name`). */
export type IntegrationEnqueueKind = "integration-sync-enqueue";

export type JobKind = StaticJobKind | IntegrationEnqueueKind;

export type JobHandler<TPayload> = (
  payload: TPayload,
  ctx: JobContext,
) => Promise<void>;

/**
 * Registry metadata for a BullMQ job family.
 * `queue` is the sole source of queue name mapping (no parallel Record<JobKind, string>).
 */
export type JobDefinition<TPayload = unknown> = {
  kind: JobKind;
  queue: string;
  /** Defaults to `kind` for static jobs. */
  bullmqJobName?: string;
  workerConcurrency: number;
  attempts: number;
  backoff: JobsOptions["backoff"];
  removeOnComplete: number;
  removeOnFail: number | false;
  /** When true, `job.name` is computed at enqueue time (integration). */
  dynamicBullmqJobName?: boolean;
  enabledInTest?: boolean;
  handler?: JobHandler<TPayload>;
};

export type BackoffConfig = Exclude<JobsOptions["backoff"], undefined>;

export function resolveBullmqJobName(definition: JobDefinition): string {
  return definition.bullmqJobName ?? definition.kind;
}

export function mergeEnqueueJobOptions(
  definition: JobDefinition,
  overrides?: JobsOptions,
): JobsOptions {
  return {
    attempts: definition.attempts,
    backoff: definition.backoff,
    removeOnComplete: definition.removeOnComplete,
    removeOnFail: definition.removeOnFail,
    ...(overrides ?? {}),
  };
}
