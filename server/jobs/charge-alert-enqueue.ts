import {
  buildChargeAlertJobId,
  isChargeAlertProducerQueueReady,
  type ChargeAlertJobPayload,
} from "../queues/charge-alert.queue.js";
import { enqueueJob } from "./enqueue.js";

const DEFAULT_PLUG_IN_DEADLINE_MINUTES = 30;
const MAX_PLUG_IN_DEADLINE_MINUTES = 1440;

function normalizePlugInDeadlineMinutes(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PLUG_IN_DEADLINE_MINUTES;
  const rounded = Math.floor(value);
  if (rounded < 1) return DEFAULT_PLUG_IN_DEADLINE_MINUTES;
  return Math.min(rounded, MAX_PLUG_IN_DEADLINE_MINUTES);
}

export async function enqueueChargeAlertJob(params: {
  returnId: string;
  equipmentId: string;
  clinicId: string;
  plugInDeadlineMinutes: number;
}): Promise<string | null> {
  const jobId = buildChargeAlertJobId(params.returnId);
  if (!isChargeAlertProducerQueueReady()) {
    return jobId;
  }
  const delayMs = normalizePlugInDeadlineMinutes(params.plugInDeadlineMinutes) * 60 * 1000;
  await enqueueJob(
    "check-plug",
    {
      returnId: params.returnId,
      equipmentId: params.equipmentId,
      clinicId: params.clinicId,
    } satisfies ChargeAlertJobPayload,
    {
      jobId,
      delayMs,
      bullmq: {
        removeOnComplete: 50,
        removeOnFail: 100,
      },
    },
  );
  return jobId;
}
