/**
 * B2b — one-time deprecation warning for pilot legacy start*Worker starters.
 */
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const { mockWorkerCtor, mockQueueCtor, mockWorkerOn, mockWorkerClose } = vi.hoisted(() => ({
  mockWorkerCtor: vi.fn(),
  mockQueueCtor: vi.fn(),
  mockWorkerOn: vi.fn(),
  mockWorkerClose: vi.fn(),
}));

vi.mock("bullmq", () => {
  function WorkerMock(this: { on: typeof mockWorkerOn; close: typeof mockWorkerClose }) {
    mockWorkerCtor();
    this.on = mockWorkerOn;
    this.close = mockWorkerClose;
  }
  function QueueMock(this: { on: typeof mockWorkerOn }) {
    mockQueueCtor();
    this.on = mockWorkerOn;
  }
  return { Worker: WorkerMock, Queue: QueueMock };
});

function legacyStarterWarnCalls(mock: ReturnType<typeof vi.spyOn>) {
  return mock.mock.calls.filter((call) => call[0] === "legacy_worker_starter_used");
}

describe("B2b — legacy pilot worker starter warnings", () => {
  beforeEach(() => {
    vi.resetModules();
    mockWorkerCtor.mockClear();
    mockQueueCtor.mockClear();
    mockWorkerOn.mockClear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("documents @deprecated on both legacy starters", () => {
    const chargeSrc = readFileSync(
      path.join(repoRoot, "server/workers/chargeAlertWorker.ts"),
      "utf8",
    );
    const inventorySrc = readFileSync(
      path.join(repoRoot, "server/workers/inventory-deduction.worker.ts"),
      "utf8",
    );
    const marker = "@deprecated Use Job Runtime registry execution instead.";
    expect(chargeSrc).toContain(marker);
    expect(chargeSrc).toContain("export async function startChargeAlertWorker");
    expect(inventorySrc).toContain(marker);
    expect(inventorySrc).toContain("export async function startInventoryDeductionWorker");
  });

  describe("startChargeAlertWorker", () => {
    it("emits legacy_worker_starter_used once on first call", async () => {
      vi.doMock("../../server/lib/redis.js", () => ({
        createRedisConnection: vi.fn().mockResolvedValue(null),
      }));

      const { startChargeAlertWorker } = await import(
        "../../server/workers/chargeAlertWorker.js"
      );

      await startChargeAlertWorker();

      const warnSpy = vi.mocked(console.warn);
      expect(legacyStarterWarnCalls(warnSpy)).toEqual([
        ["legacy_worker_starter_used", { name: "startChargeAlertWorker" }],
      ]);
    });

    it("does not emit additional legacy warnings on repeated calls", async () => {
      vi.doMock("../../server/lib/redis.js", () => ({
        createRedisConnection: vi.fn().mockResolvedValue(null),
      }));

      const { startChargeAlertWorker } = await import(
        "../../server/workers/chargeAlertWorker.js"
      );

      await startChargeAlertWorker();
      await startChargeAlertWorker();

      expect(legacyStarterWarnCalls(vi.mocked(console.warn))).toHaveLength(1);
    });

    it("preserves starter behavior when Redis is available", async () => {
      vi.doMock("../../server/lib/redis.js", () => ({
        createRedisConnection: vi.fn().mockResolvedValue({ on: vi.fn() }),
      }));

      const { startChargeAlertWorker } = await import(
        "../../server/workers/chargeAlertWorker.js"
      );

      await startChargeAlertWorker();

      expect(mockQueueCtor).toHaveBeenCalled();
      expect(mockWorkerCtor).toHaveBeenCalled();
    });
  });

  describe("startInventoryDeductionWorker", () => {
    it("emits legacy_worker_starter_used once on first call", async () => {
      vi.doMock("../../server/lib/redis.js", () => ({
        createRedisConnection: vi.fn().mockResolvedValue(null),
      }));

      const { startInventoryDeductionWorker } = await import(
        "../../server/workers/inventory-deduction.worker.js"
      );

      await startInventoryDeductionWorker();

      const warnSpy = vi.mocked(console.warn);
      expect(legacyStarterWarnCalls(warnSpy)).toEqual([
        ["legacy_worker_starter_used", { name: "startInventoryDeductionWorker" }],
      ]);
    });

    it("does not emit additional legacy warnings on repeated calls", async () => {
      vi.doMock("../../server/lib/redis.js", () => ({
        createRedisConnection: vi.fn().mockResolvedValue(null),
      }));

      const { startInventoryDeductionWorker } = await import(
        "../../server/workers/inventory-deduction.worker.js"
      );

      await startInventoryDeductionWorker();
      await startInventoryDeductionWorker();

      expect(legacyStarterWarnCalls(vi.mocked(console.warn))).toHaveLength(1);
    });

    it("preserves starter behavior when Redis is available", async () => {
      vi.doMock("../../server/lib/redis.js", () => ({
        createRedisConnection: vi.fn().mockResolvedValue({ on: vi.fn() }),
      }));

      const { startInventoryDeductionWorker } = await import(
        "../../server/workers/inventory-deduction.worker.js"
      );

      await startInventoryDeductionWorker();

      expect(mockWorkerCtor).toHaveBeenCalled();
    });
  });
});
