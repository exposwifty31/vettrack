import type { Queue } from "bullmq";

export const CHARGE_ALERT_QUEUE_NAME = "charge-alert";
export const CHARGE_ALERT_JOB_NAME = "check-plug";
export const CHARGE_ALERT_JOB_PREFIX = "plug-check-";

export type ChargeAlertJobPayload = {
  returnId: string;
  equipmentId: string;
  clinicId: string;
};

let chargeAlertProducerQueue: Queue | null = null;
let chargeAlertProducerQueueInitialized = false;

export function buildChargeAlertJobId(returnId: string): string {
  return `${CHARGE_ALERT_JOB_PREFIX}${returnId}`;
}

/** Binds the producer queue used by charge-alert enqueue (e.g. job runtime startup). */
export function bindChargeAlertProducerQueue(queue: Queue): void {
  chargeAlertProducerQueue = queue;
  chargeAlertProducerQueueInitialized = true;
}

export function isChargeAlertProducerQueueReady(): boolean {
  return chargeAlertProducerQueue !== null;
}

export function getChargeAlertProducerQueue(): Queue | null {
  return chargeAlertProducerQueue;
}

export function isChargeAlertProducerQueueInitialized(): boolean {
  return chargeAlertProducerQueueInitialized;
}
