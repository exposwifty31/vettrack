import type { JobsOptions } from "bullmq";
import { MAX_INVENTORY_JOB_RETRIES } from "../../lib/inventory-constants.js";
import {
  ADMISSION_FANOUT_JOB_NAME,
  ADMISSION_FANOUT_QUEUE_NAME,
  type AdmissionFanoutJobData,
} from "../../queues/admission-fanout.queue.js";
import {
  INTEGRATION_QUEUE_LEGACY_NAME,
  integrationQueueNameForClinic,
} from "../../queues/integration-shards.js";
import {
  type IntegrationSyncJobData,
  type IntegrationSyncJobType,
  type IntegrationSyncDirection,
} from "../../queues/integration.queue.js";
import {
  INVENTORY_DEDUCTION_JOB_NAME,
  INVENTORY_DEDUCTION_QUEUE_NAME,
  type InventoryDeductionJobData,
} from "../../queues/inventory-deduction.queue.js";
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
} from "../../workers/chargeAlertWorker.js";
import {
  resolveBullmqJobName,
  type JobDefinition,
  type StaticJobKind,
} from "../registry.js";

export const EXPIRY_CHECK_QUEUE_NAME = "expiry-check";
export const EXPIRY_CHECK_JOB_NAME = "check-expiry";

export const STALE_CHECKIN_SWEEP_QUEUE_NAME = "stale-checkin-sweep";
export const STALE_CHECKIN_SWEEP_JOB_NAME = "sweep-stale-checkins";

/** Matches {@link STALE_TASK_OWNERSHIP_SWEEP_DEDUP_WINDOW_MS} in staleTaskOwnershipSweep.queue.ts */
export const STALE_TASK_OWNERSHIP_SWEEP_DEDUP_WINDOW_MS = 60_000;

export type ChargeAlertJobPayload = {
  returnId: string;
  equipmentId: string;
  clinicId: string;
};

export type ExpiryCheckJobPayload = Record<string, never>;

export type StaleCheckInSweepJobPayload = Record<string, never>;

export type PayloadForStaticKind = {
  "inventory-deduction": InventoryDeductionJobData;
  "check-plug": ChargeAlertJobPayload;
  "admission-fanout": AdmissionFanoutJobData;
  "task-ownership-backfill": TaskOwnershipBackfillJobData;
  "stale-task-ownership-sweep": StaleTaskOwnershipSweepJobData;
  "check-expiry": ExpiryCheckJobPayload;
  "sweep-stale-checkins": StaleCheckInSweepJobPayload;
};

const inventoryDeductionDefinition: JobDefinition<InventoryDeductionJobData> = {
  kind: INVENTORY_DEDUCTION_JOB_NAME,
  queue: INVENTORY_DEDUCTION_QUEUE_NAME,
  bullmqJobName: INVENTORY_DEDUCTION_JOB_NAME,
  workerConcurrency: 1,
  attempts: MAX_INVENTORY_JOB_RETRIES,
  backoff: { type: "exponential", delay: 5000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
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

const admissionFanoutDefinition: JobDefinition<AdmissionFanoutJobData> = {
  kind: ADMISSION_FANOUT_JOB_NAME,
  queue: ADMISSION_FANOUT_QUEUE_NAME,
  bullmqJobName: ADMISSION_FANOUT_JOB_NAME,
  workerConcurrency: 5,
  attempts: 3,
  backoff: { type: "exponential", delay: 3000 },
  removeOnComplete: 500,
  removeOnFail: 2000,
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

export const staticJobDefinitions = [
  inventoryDeductionDefinition,
  chargeAlertDefinition,
  admissionFanoutDefinition,
  taskOwnershipBackfillDefinition,
  staleTaskOwnershipSweepDefinition,
  expiryCheckDefinition,
  staleCheckInSweepDefinition,
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
  definitions: readonly JobDefinition[],
): Map<string, JobDefinition[]> {
  const byQueue = new Map<string, JobDefinition[]>();
  for (const definition of definitions) {
    const list = byQueue.get(definition.queue) ?? [];
    list.push(definition);
    byQueue.set(definition.queue, list);
  }
  return byQueue;
}

export const definitionByKind = new Map<StaticJobKind, JobDefinition>(
  staticJobDefinitions.map((definition) => [
    definition.kind as StaticJobKind,
    definition,
  ]),
);

export const definitionsByQueue = buildDefinitionsByQueue(staticJobDefinitions);

/** Phase 1b pilot queues — one worker per queue in {@link startJobRuntime}. */
export const PILOT_QUEUE_NAMES = [
  INVENTORY_DEDUCTION_QUEUE_NAME,
  CHARGE_ALERT_QUEUE_NAME,
] as const;

export type PilotQueueName = (typeof PILOT_QUEUE_NAMES)[number];

export function isPilotQueueName(queueName: string): queueName is PilotQueueName {
  return (PILOT_QUEUE_NAMES as readonly string[]).includes(queueName);
}

export function resolveDefinitionForJobName(
  queueName: string,
  jobName: string,
): JobDefinition | undefined {
  const defs = definitionsByQueue.get(queueName);
  if (!defs) return undefined;
  return defs.find((def) => resolveBullmqJobName(def) === jobName);
}

export { resolveBullmqJobName };

export function getStaticJobDefinition(kind: StaticJobKind): JobDefinition {
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

export type { IntegrationSyncJobData, IntegrationSyncJobType, IntegrationSyncDirection };

export { INTEGRATION_QUEUE_LEGACY_NAME, STALE_TASK_OWNERSHIP_SWEEP_QUEUE_NAME };
