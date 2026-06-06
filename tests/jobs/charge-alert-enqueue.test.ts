/**
 * Job Registry 1c-1 — charge-alert producer delegates to enqueueJob().
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Queue } from "bullmq";

const mockEnqueueJob = vi.hoisted(() => vi.fn().mockResolvedValue({ id: "job-1" }));

vi.mock("../../server/jobs/enqueue.js", () => ({
  enqueueJob: mockEnqueueJob,
}));

import { enqueueChargeAlertJob } from "../../server/jobs/charge-alert-enqueue.js";
import {
  bindChargeAlertProducerQueue,
  buildChargeAlertJobId,
  CHARGE_ALERT_JOB_NAME,
} from "../../server/queues/charge-alert.queue.js";

describe("enqueueChargeAlertJob — enqueueJob delegation (1c-1)", () => {
  beforeEach(() => {
    mockEnqueueJob.mockClear();
    bindChargeAlertProducerQueue({} as Queue);
  });

  it("calls enqueueJob with check-plug kind when producer queue is bound", async () => {
    const params = {
      returnId: "ret-42",
      equipmentId: "eq-7",
      clinicId: "clinic-a",
      plugInDeadlineMinutes: 45,
    };

    const jobId = await enqueueChargeAlertJob(params);

    expect(jobId).toBe(buildChargeAlertJobId("ret-42"));
    expect(mockEnqueueJob).toHaveBeenCalledTimes(1);
    expect(mockEnqueueJob.mock.calls[0]?.[0]).toBe(CHARGE_ALERT_JOB_NAME);
    expect(mockEnqueueJob).toHaveBeenCalledWith(
      "check-plug",
      {
        returnId: "ret-42",
        equipmentId: "eq-7",
        clinicId: "clinic-a",
      },
      {
        jobId: buildChargeAlertJobId("ret-42"),
        delayMs: 45 * 60 * 1000,
        bullmq: {
          removeOnComplete: 50,
          removeOnFail: 100,
        },
      },
    );
    expect(CHARGE_ALERT_JOB_NAME).toBe("check-plug");
  });

  it("does not call enqueueJob when producer queue is not bound", async () => {
    bindChargeAlertProducerQueue(null as unknown as Queue);

    const jobId = await enqueueChargeAlertJob({
      returnId: "ret-offline",
      equipmentId: "eq-1",
      clinicId: "clinic-x",
      plugInDeadlineMinutes: 30,
    });

    expect(jobId).toBe(buildChargeAlertJobId("ret-offline"));
    expect(mockEnqueueJob).not.toHaveBeenCalled();
  });
});
