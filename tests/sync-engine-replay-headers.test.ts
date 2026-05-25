/**
 * Phase 4 — sync-engine replay sends stored idempotency headers (no regeneration).
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const SYNC_ENGINE_SOURCE = readFileSync(
  join(process.cwd(), "src/lib/sync-engine.ts"),
  "utf8",
);

describe("sync-engine replay headers", () => {
  it("sends Idempotency-Key from pending row when present", () => {
    expect(SYNC_ENGINE_SOURCE).toContain('headers["Idempotency-Key"]');
    expect(SYNC_ENGINE_SOURCE).toContain("item.idempotencyKey");
  });

  it("sends X-Client-Mutation-Id from pending row when present", () => {
    expect(SYNC_ENGINE_SOURCE).toContain('headers["X-Client-Mutation-Id"]');
    expect(SYNC_ENGINE_SOURCE).toContain("item.clientMutationId");
  });

  it("does not regenerate idempotency keys during replay", () => {
    expect(SYNC_ENGINE_SOURCE).not.toMatch(/randomUUID\(\)/);
  });

  it("preserves FIFO ordering via getPendingSync (sorted in offline-db)", () => {
    const offlineDbSource = readFileSync(join(process.cwd(), "src/lib/offline-db.ts"), "utf8");
    expect(SYNC_ENGINE_SOURCE).toContain("getPendingSync()");
    expect(offlineDbSource).toContain("sortBy(\"clientTimestamp\")");
  });

  it("still sends X-Client-Timestamp for offline replay", () => {
    expect(SYNC_ENGINE_SOURCE).toContain('headers["X-Client-Timestamp"]');
  });
});
