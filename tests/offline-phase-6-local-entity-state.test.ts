import { describe, expect, it } from "vitest";
import {
  extractEquipmentIdFromPendingSync,
  resolveLocalEntityState,
  type LocalEntityState,
} from "../src/lib/local-entity-sync-state";
import type { PendingSync } from "../src/lib/offline-db";

function row(
  endpoint: string,
  status: PendingSync["status"],
  overrides?: Partial<PendingSync>,
): PendingSync {
  return {
    type: "scan",
    endpoint,
    method: "POST",
    body: "{}",
    createdAt: new Date(),
    retries: 0,
    status,
    clientTimestamp: Date.now(),
    clientMutationId: "m1",
    idempotencyKey: "k1",
    schemaVersion: 2,
    updatedAt: new Date(),
    structuredError: null,
    ...overrides,
  };
}

describe("offline phase 6 — LocalEntityState", () => {
  const EQ = "eq-abc";

  it("extracts equipment id from endpoint subpaths", () => {
    expect(
      extractEquipmentIdFromPendingSync(row(`/api/equipment/${EQ}/checkout`, "pending")),
    ).toBe(EQ);
  });

  it("returns synced when no rows match equipment", () => {
    expect(
      resolveLocalEntityState(EQ, [row("/api/equipment/other/scan", "pending")]),
    ).toBe("synced");
  });

  const cases: Array<{
    label: string;
    rows: PendingSync[];
    expected: LocalEntityState;
  }> = [
    {
      label: "conflict wins over pending",
      rows: [
        row(`/api/equipment/${EQ}/return`, "pending"),
        row(`/api/equipment/${EQ}/checkout`, "conflict"),
      ],
      expected: "conflict",
    },
    {
      label: "dead → sync_failed",
      rows: [row(`/api/equipment/${EQ}/scan`, "dead")],
      expected: "sync_failed",
    },
    {
      label: "pending → pending_sync",
      rows: [row(`/api/equipment/${EQ}/scan`, "pending")],
      expected: "pending_sync",
    },
    {
      label: "processing → pending_sync",
      rows: [row(`/api/equipment/${EQ}/seen`, "processing")],
      expected: "pending_sync",
    },
    {
      label: "legacy failed → sync_failed",
      rows: [row(`/api/equipment/${EQ}/scan`, "failed")],
      expected: "sync_failed",
    },
    {
      label: "dead wins over pending",
      rows: [
        row(`/api/equipment/${EQ}/scan`, "pending"),
        row(`/api/equipment/${EQ}/checkout`, "dead"),
      ],
      expected: "sync_failed",
    },
    {
      label: "synced when only synced rows",
      rows: [row(`/api/equipment/${EQ}/scan`, "synced")],
      expected: "synced",
    },
  ];

  it.each(cases)("$label", ({ rows, expected }) => {
    expect(resolveLocalEntityState(EQ, rows)).toBe(expected);
  });
});
