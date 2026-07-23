import type { JobsOptions } from "bullmq";
import { integrationQueueNameForClinic } from "../../queues/integration-shards.js";
import {
  type IntegrationSyncJobData,
  type IntegrationSyncJobType,
  type IntegrationSyncDirection,
} from "../../queues/integration.queue.js";
import {
  STALE_TASK_OWNERSHIP_SWEEP_JOB_NAME,
  STALE_TASK_OWNERSHIP_SWEEP_QUEUE_NAME,
  type StaleTaskOwnershipSweepJobData,
} from "../../queues/staleTaskOwnershipSweep.queue.js";
import {
  TASK_OWNERSHIP_BACKFILL_JOB_NAME,
  TASK_OWNERSHIP_BACKFILL_QUEUE_NAME,
  type TaskOwnershipBackfillJobData,
} from "../../queues/taskOwnershipBackfill.queue.js";
import {
  CHARGE_ALERT_JOB_NAME,
  CHARGE_ALERT_QUEUE_NAME,
  type ChargeAlertJobPayload,
} from "../../queues/charge-alert.queue.js";
import {
  STALE_CHECKOUT_SWEEP_JOB_NAME,
  STALE_CHECKOUT_SWEEP_QUEUE_NAME,
} from "../../workers/staleCheckoutSweepWorker.js";
import {
  STALE_RETURNED_SWEEP_JOB_NAME,
  STALE_RETURNED_SWEEP_QUEUE_NAME,
} from "../../workers/stale-returned-sweep.worker.js";
import {
  SWEEP_ESCALATION_JOB_NAME,
  SWEEP_ESCALATION_QUEUE_NAME,
} from "../../workers/sweep-escalation.worker.js";
import {
  AUTOPILOT_RESTOCK_BURN_JOB_NAME,
  AUTOPILOT_RESTOCK_BURN_QUEUE_NAME,
} from "../../workers/autopilotRestockBurnWorker.js";
import {
  AUTOPILOT_COORDINATOR_REASSIGN_JOB_NAME,
  AUTOPILOT_COORDINATOR_REASSIGN_QUEUE_NAME,
} from "../../workers/autopilotCoordinatorReassignWorker.js";
import {
  resolveBullmqJobName,
  type AnyJobDefinition,
  type JobDefinition,
  type StaticJobKind,
} from "../registry.js";

export const EXPIRY_CHECK_QUEUE_NAME = "expiry-check";
export const EXPIRY_CHECK_JOB_NAME = "check-expiry";

export const STALE_CHECKIN_SWEEP_QUEUE_NAME = "stale-checkin-sweep";
export const STALE_CHECKIN_SWEEP_JOB_NAME = "sweep-stale-checkins";

const STALE_TASK_OWNERSHIP_SWEEP_DEDUP_WINDOW_MS = 60_000;

export type ExpiryCheckJobPayload = Record<string, never>;

export type StaleCheckInSweepJobPayload = Record<string, never>;

export type StaleCheckoutSweepJobPayload = Record<string, never>;

export type StaleReturnedSweepJobPayload = Record<string, never>;

export type SweepEscalationJobPayload = Record<string, never>;

/** VetTrack 2.0, Task 1.1 §4 — `autopilotRestockBurnWorker.ts`'s scan job. */
export type RestockBurnScanJobPayload = Record<string, never>;
export type CoordinatorReassignScanJobPayload = Record<string, never>;

export type PayloadForStaticKind = {
  "check-plug": ChargeAlertJobPayload;
  "task-ownership-backfill": TaskOwnershipBackfillJobData;
  "stale-task-ownership-sweep": StaleTaskOwnershipSweepJobData;
  "check-expiry": ExpiryCheckJobPayload;
  "sweep-stale-checkins": StaleCheckInSweepJobPayload;
  "sweep-stale-checkouts": StaleCheckoutSweepJobPayload;
  "sweep-stale-returned": StaleReturnedSweepJobPayload;
  "sweep-room-escalation": SweepEscalationJobPayload;
  "scan-restock-burn": RestockBurnScanJobPayload;
  "scan-coordinator-reassign": CoordinatorReassignScanJobPayload;
};

/** Producer uses per-add opts only (no queue defaultJobOptions); attempts follow BullMQ default (1). */
const chargeAlertDefinition: JobDefinition<ChargeAlertJobPayload> = {
  kind: CHARGE_ALERT_JOB_NAME,
  queue: CHARGE_ALERT_QUEUE_NAME,
  bullmqJobName: CHARGE_ALERT_JOB_NAME,
  workerConcurrency: 1,
  attempts: 1,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: 50,
  removeOnFail: 100,
};

const taskOwnershipBackfillDefinition: JobDefinition<TaskOwnershipBackfillJobData> = {
  kind: TASK_OWNERSHIP_BACKFILL_JOB_NAME,
  queue: TASK_OWNERSHIP_BACKFILL_QUEUE_NAME,
  bullmqJobName: TASK_OWNERSHIP_BACKFILL_JOB_NAME,
  workerConcurrency: 1,
  attempts: 3,
  backoff: { type: "exponential", delay: 5000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

const staleTaskOwnershipSweepDefinition: JobDefinition<StaleTaskOwnershipSweepJobData> = {
  kind: STALE_TASK_OWNERSHIP_SWEEP_JOB_NAME,
  queue: STALE_TASK_OWNERSHIP_SWEEP_QUEUE_NAME,
  bullmqJobName: STALE_TASK_OWNERSHIP_SWEEP_JOB_NAME,
  workerConcurrency: 1,
  attempts: 3,
  backoff: { type: "exponential", delay: 5000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

/** Repeat/cron job — per-add options in worker use removeOnComplete 50 / removeOnFail 100. */
const expiryCheckDefinition: JobDefinition<ExpiryCheckJobPayload> = {
  kind: EXPIRY_CHECK_JOB_NAME,
  queue: EXPIRY_CHECK_QUEUE_NAME,
  bullmqJobName: EXPIRY_CHECK_JOB_NAME,
  workerConcurrency: 1,
  attempts: 3,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: 50,
  removeOnFail: 100,
};

const staleCheckInSweepDefinition: JobDefinition<StaleCheckInSweepJobPayload> = {
  kind: STALE_CHECKIN_SWEEP_JOB_NAME,
  queue: STALE_CHECKIN_SWEEP_QUEUE_NAME,
  bullmqJobName: STALE_CHECKIN_SWEEP_JOB_NAME,
  workerConcurrency: 1,
  attempts: 3,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: 50,
  removeOnFail: 100,
};

const staleCheckoutSweepDefinition: JobDefinition<StaleCheckoutSweepJobPayload> = {
  kind: STALE_CHECKOUT_SWEEP_JOB_NAME,
  queue: STALE_CHECKOUT_SWEEP_QUEUE_NAME,
  bullmqJobName: STALE_CHECKOUT_SWEEP_JOB_NAME,
  workerConcurrency: 1,
  attempts: 3,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: 50,
  removeOnFail: 100,
};

const staleReturnedSweepDefinition: JobDefinition<StaleReturnedSweepJobPayload> = {
  kind: STALE_RETURNED_SWEEP_JOB_NAME,
  queue: STALE_RETURNED_SWEEP_QUEUE_NAME,
  bullmqJobName: STALE_RETURNED_SWEEP_JOB_NAME,
  workerConcurrency: 1,
  attempts: 3,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: 50,
  removeOnFail: 100,
};

const sweepEscalationDefinition: JobDefinition<SweepEscalationJobPayload> = {
  kind: SWEEP_ESCALATION_JOB_NAME,
  queue: SWEEP_ESCALATION_QUEUE_NAME,
  bullmqJobName: SWEEP_ESCALATION_JOB_NAME,
  workerConcurrency: 1,
  attempts: 3,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: 50,
  removeOnFail: 100,
};

/**
 * VetTrack 2.0, Task 1.1 §4 — registers `autopilotRestockBurnWorker.ts`'s
 * scan job for the E3 job-registry/enqueue-parity tripwire
 * (`tests/jobs/job-registry-parity.test.ts`), mirroring
 * `sweepEscalationDefinition`'s pattern for a standalone (non-Job-registry-
 * 1b-runtime) inline Queue/Worker file.
 *
 */
const coordinatorReassignScanDefinition: JobDefinition<CoordinatorReassignScanJobPayload> = {
  kind: AUTOPILOT_COORDINATOR_REASSIGN_JOB_NAME,
  queue: AUTOPILOT_COORDINATOR_REASSIGN_QUEUE_NAME,
  bullmqJobName: AUTOPILOT_COORDINATOR_REASSIGN_JOB_NAME,
  workerConcurrency: 1,
  attempts: 3,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: 50,
  removeOnFail: 100,
};

const restockBurnScanDefinition: JobDefinition<RestockBurnScanJobPayload> = {
  kind: AUTOPILOT_RESTOCK_BURN_JOB_NAME,
  queue: AUTOPILOT_RESTOCK_BURN_QUEUE_NAME,
  bullmqJobName: AUTOPILOT_RESTOCK_BURN_JOB_NAME,
  workerConcurrency: 1,
  attempts: 3,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: 50,
  removeOnFail: 100,
};

export const staticJobDefinitions = [
  chargeAlertDefinition,
  taskOwnershipBackfillDefinition,
  staleTaskOwnershipSweepDefinition,
  expiryCheckDefinition,
  staleCheckInSweepDefinition,
  staleCheckoutSweepDefinition,
  staleReturnedSweepDefinition,
  sweepEscalationDefinition,
  restockBurnScanDefinition,
  coordinatorReassignScanDefinition,
] as const;

/** Integration enqueue metadata (dynamic job.name, shard queue per clinic). */
export const integrationSyncEnqueueDefinition = {
  kind: "integration-sync-enqueue" as const,
  dynamicBullmqJobName: true,
  workerConcurrency: 2,
  attempts: 3,
  backoff: { type: "exponential", delay: 10000 } as JobsOptions["backoff"],
  removeOnComplete: 500,
  removeOnFail: 2000,
};

export function integrationQueueForPayload(data: IntegrationSyncJobData): string {
  return integrationQueueNameForClinic(data.clinicId);
}

export function integrationBullmqJobName(data: IntegrationSyncJobData): string {
  return `${data.adapterId}:${data.syncType}:${data.direction}`;
}

export function defaultIntegrationJobId(data: IntegrationSyncJobData): string {
  return `${data.clinicId}:${data.adapterId}:${data.syncType}:${data.direction}`;
}

export function buildStaleTaskOwnershipSweepJobId(
  clinicId: string,
  nowMs: number = Date.now(),
): string {
  const bucket = Math.floor(nowMs / STALE_TASK_OWNERSHIP_SWEEP_DEDUP_WINDOW_MS);
  return `${STALE_TASK_OWNERSHIP_SWEEP_QUEUE_NAME}:${clinicId}:${bucket}`;
}

function buildDefinitionsByQueue(
  definitions: readonly AnyJobDefinition[],
): Map<string, AnyJobDefinition[]> {
  const byQueue = new Map<string, AnyJobDefinition[]>();
  for (const definition of definitions) {
    const list = byQueue.get(definition.queue) ?? [];
    list.push(definition);
    byQueue.set(definition.queue, list);
  }
  return byQueue;
}

export const definitionByKind = new Map<StaticJobKind, AnyJobDefinition>(
  staticJobDefinitions.map((definition) => [
    definition.kind as StaticJobKind,
    definition as AnyJobDefinition,
  ]),
);

export const definitionsByQueue = buildDefinitionsByQueue(
  staticJobDefinitions as readonly AnyJobDefinition[],
);

/** Phase 1b+ runtime queues — one worker per queue in {@link startJobRuntime}. */
export const PILOT_QUEUE_NAMES = [
  CHARGE_ALERT_QUEUE_NAME,
  EXPIRY_CHECK_QUEUE_NAME,
  STALE_CHECKIN_SWEEP_QUEUE_NAME,
] as const;

export type PilotQueueName = (typeof PILOT_QUEUE_NAMES)[number];

export function isPilotQueueName(queueName: string): queueName is PilotQueueName {
  return (PILOT_QUEUE_NAMES as readonly string[]).includes(queueName);
}

export function resolveDefinitionForJobName(
  queueName: string,
  jobName: string,
): AnyJobDefinition | undefined {
  const defs = definitionsByQueue.get(queueName);
  if (!defs) return undefined;
  return defs.find((def) => resolveBullmqJobName(def) === jobName);
}

export { resolveBullmqJobName };

export function getStaticJobDefinition(kind: StaticJobKind): AnyJobDefinition {
  const definition = definitionByKind.get(kind);
  if (!definition) {
    throw new Error(`Unknown static JobKind: ${kind}`);
  }
  return definition;
}

export function assertJobRegistryConsistency(): void {
  const kinds = new Set<string>();
  for (const definition of staticJobDefinitions) {
    if (kinds.has(definition.kind)) {
      throw new Error(`Duplicate JobKind in registry: ${definition.kind}`);
    }
    kinds.add(definition.kind);
    if (!definition.queue.trim()) {
      throw new Error(`JobKind ${definition.kind} has empty queue`);
    }
    const jobName = definition.bullmqJobName ?? definition.kind;
    if (definition.kind !== jobName && !definition.dynamicBullmqJobName) {
      throw new Error(
        `JobKind ${definition.kind} must match bullmqJobName ${jobName} for static jobs`,
      );
    }
  }

  for (const [queueName, defs] of definitionsByQueue) {
    if (defs.length === 0) {
      throw new Error(`definitionsByQueue has empty entry for ${queueName}`);
    }
    for (const def of defs) {
      if (def.queue !== queueName) {
        throw new Error(
          `definitionsByQueue mismatch: key ${queueName} vs def.queue ${def.queue}`,
        );
      }
    }
  }

  const queueNamesFromDefs = new Set(staticJobDefinitions.map((d) => d.queue));
  if (queueNamesFromDefs.size !== definitionsByQueue.size) {
    throw new Error("definitionsByQueue size does not match unique queue count");
  }
}

export type {
  ChargeAlertJobPayload,
  IntegrationSyncJobData,
  IntegrationSyncJobType,
  IntegrationSyncDirection,
};

export { STALE_TASK_OWNERSHIP_SWEEP_QUEUE_NAME };
