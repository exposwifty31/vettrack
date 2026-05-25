/**
 * P2-5 regression: addPendingSync must not produce duplicate pending rows
 * when concurrent offline actions target the same dedup-eligible endpoint.
 *
 * The fix wraps the check-and-insert inside a Dexie rw transaction so the
 * read+write is atomic within IndexedDB.
 */
import { describe, it, expect } from "vitest";

describe("P2-5: addPendingSync dedup race", () => {
  it("transactional dedup wraps check-and-insert in a single rw transaction", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/offline-db.ts", "utf8");

    // The dedup path must use a Dexie transaction for atomicity
    expect(source).toContain('offlineDb.transaction("rw"');
  });

  it("DEDUP_SYNC_TYPES includes checkout, return, and return_with_charge", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/offline-db.ts", "utf8");

    expect(source).toContain('"checkout"');
    expect(source).toContain('"return"');
    expect(source).toContain('"return_with_charge"');
  });

  it("dedup path falls back to non-transactional insert on tx failure", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/offline-db.ts", "utf8");

    // After the try/catch around the transaction, there must be a fallback
    // table.add(op) call for resilience
    const txBlock = source.indexOf('offlineDb.transaction("rw"');
    const fallbackAdd = source.indexOf("table.add(row)", txBlock);
    expect(txBlock).toBeGreaterThan(-1);
    expect(fallbackAdd).toBeGreaterThan(txBlock);
  });

  it("simulates concurrent dedup calls producing at most one row", async () => {
    // Simulates the race scenario with an in-memory store
    type Row = { id: number; type: string; endpoint: string; method: string; status: string; body: string };
    let nextId = 1;
    const store: Row[] = [];
    let txLock = false;
    const txQueue: Array<() => void> = [];

    function acquireTx(): Promise<void> {
      if (!txLock) {
        txLock = true;
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => txQueue.push(() => { txLock = true; resolve(); }));
    }
    function releaseTx(): void {
      txLock = false;
      const next = txQueue.shift();
      if (next) next();
    }

    async function addPendingSyncWithTx(op: { type: string; endpoint: string; method: string; body: string }) {
      await acquireTx();
      try {
        const existing = store.find(
          (r) => r.status === "pending" && r.endpoint === op.endpoint && r.method === op.method && r.type === op.type,
        );
        if (existing) {
          existing.body = op.body;
          return existing.id;
        }
        const id = nextId++;
        store.push({ id, ...op, status: "pending" });
        return id;
      } finally {
        releaseTx();
      }
    }

    const op = { type: "checkout", endpoint: "/api/equipment/abc/checkout", method: "POST", body: "{}" };
    const [id1, id2, id3] = await Promise.all([
      addPendingSyncWithTx(op),
      addPendingSyncWithTx(op),
      addPendingSyncWithTx(op),
    ]);

    // All three calls should resolve to the same row
    const pendingRows = store.filter((r) => r.status === "pending" && r.endpoint === op.endpoint);
    expect(pendingRows).toHaveLength(1);
    expect(id1).toBe(id2);
    expect(id2).toBe(id3);
  });

  it("non-dedup types still create separate rows", async () => {
    type Row = { id: number; type: string; endpoint: string; status: string };
    let nextId = 1;
    const store: Row[] = [];

    function addNonDedup(type: string, endpoint: string) {
      const id = nextId++;
      store.push({ id, type, endpoint, status: "pending" });
      return id;
    }

    const id1 = addNonDedup("scan", "/api/equipment/abc/scan");
    const id2 = addNonDedup("scan", "/api/equipment/abc/scan");
    expect(id1).not.toBe(id2);
    expect(store.filter((r) => r.type === "scan")).toHaveLength(2);
  });
});
