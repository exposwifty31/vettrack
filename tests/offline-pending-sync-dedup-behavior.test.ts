/**
 * Phase 1–2 — policy gate before dedup; unknown enqueue rejected without queue mutation.
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { UnknownOfflineMutationError } from "../src/lib/offline-policy";
import {
  addPendingSync,
  getPendingSync,
  offlineDb,
  type PendingSyncCreateInput,
} from "../src/lib/offline-db";

function baseOp(
  overrides: Partial<PendingSyncCreateInput> & Pick<PendingSyncCreateInput, "type" | "endpoint">,
): PendingSyncCreateInput {
  return {
    method: "POST",
    body: "{}",
    createdAt: new Date(),
    retries: 0,
    status: "pending",
    clientTimestamp: Date.now(),
    ...overrides,
  };
}

describe("addPendingSync dedup after policy gate", () => {
  beforeEach(async () => {
    await offlineDb.delete();
    await offlineDb.open();
  });

  it("rejects unknown enqueue without mutating the queue", async () => {
    await expect(
      addPendingSync(
        baseOp({
          type: "scan",
          endpoint: "/api/unknown/custom",
          method: "POST",
        }),
      ),
    ).rejects.toBeInstanceOf(UnknownOfflineMutationError);

    const pending = await getPendingSync();
    expect(pending).toHaveLength(0);
  });

  it("collapses duplicate checkout enqueue to one pending row", async () => {
    const endpoint = "/api/equipment/eq-dedup/checkout";
    const op = baseOp({ type: "checkout", endpoint, clientTimestamp: 1000 });
    await addPendingSync(op);
    await addPendingSync({ ...op, clientTimestamp: 2001, body: '{"location":"B"}' });
    const pending = await getPendingSync();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.endpoint).toBe(endpoint);
    expect(pending[0]?.clientTimestamp).toBe(2001);
  });

  it("preserves clientMutationId and idempotencyKey when dedup overwrites a row", async () => {
    const endpoint = "/api/equipment/eq-dedup/checkout";
    const op = baseOp({ type: "checkout", endpoint, clientTimestamp: 1000 });
    await addPendingSync(op);
    const first = (await getPendingSync())[0]!;
    await addPendingSync({ ...op, clientTimestamp: 2001, body: "{}" });
    const second = (await getPendingSync())[0]!;
    expect(second.clientMutationId).toBe(first.clientMutationId);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  });

  it("collapses duplicate return enqueue to one pending row", async () => {
    const endpoint = "/api/equipment/eq-dedup/return";
    const op = baseOp({ type: "return", endpoint, clientTimestamp: 3000 });
    await addPendingSync(op);
    await addPendingSync({ ...op, clientTimestamp: 4000 });
    const pending = await getPendingSync();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.type).toBe("return");
  });

  it("keeps scan enqueues append-only (two rows)", async () => {
    const endpoint = "/api/equipment/eq-dedup/scan";
    await addPendingSync(
      baseOp({ type: "scan", endpoint, clientTimestamp: 5000, body: '{"status":"ok"}' }),
    );
    await addPendingSync(
      baseOp({ type: "scan", endpoint, clientTimestamp: 6000, body: '{"status":"maintenance"}' }),
    );
    const pending = await getPendingSync();
    expect(pending).toHaveLength(2);
    expect(pending.map((r) => r.clientTimestamp).sort()).toEqual([5000, 6000]);
  });
});
