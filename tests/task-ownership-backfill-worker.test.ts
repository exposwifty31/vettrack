/**
 * Phase 3 PR 3.2 — task-ownership backfill worker unit tests.
 *
 * Tests the `applyResolution` function in isolation with a stubbed `db`.
 * The full `processBackfillJob` is exercised indirectly: this suite focuses
 * on the per-row write semantics, which is where the integrity invariants
 * live (clinic-scope guard, IS NULL guard, dryRun behavior, ON CONFLICT DO
 * NOTHING).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// `vi.hoisted` keeps these initialized before `vi.mock` factories run, so
// the db mock can reference `fluent` without ReferenceError under vitest's
// import-hoisting transform.
const { calls, fluent } = vi.hoisted(() => {
  type Call = { method: string; args: unknown[] };
  const calls: Call[] = [];
  const fluent: Record<string, unknown> = {};
  function recorder(method: string) {
    return (...args: unknown[]) => {
      calls.push({ method, args });
      return fluent;
    };
  }
  for (const m of [
    "insert",
    "values",
    "onConflictDoNothing",
    "update",
    "set",
    "where",
    "returning",
    "select",
    "from",
    "limit",
    "offset",
  ]) {
    fluent[m] = recorder(m);
  }
  (fluent as { then?: unknown }).then = (resolve: (v: unknown) => unknown) => resolve([]);
  return { calls, fluent };
});

vi.mock("../server/db.js", () => ({
  db: fluent,
  appointments: { id: "appointments.id", clinicId: "appointments.clinicId", acknowledgedUserId: "appointments.acknowledgedUserId" },
  taskOwnershipConfirmQueue: {
    clinicId: "queue.clinicId",
    appointmentId: "queue.appointmentId",
    rawAcknowledgedBy: "queue.rawAcknowledgedBy",
  },
  users: {},
}));

// Resolver is loaded but not invoked by these tests (we drive applyResolution
// directly with synthesized Resolution values).
vi.mock("../server/lib/task-ownership-resolver.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../server/lib/task-ownership-resolver.js")>();
  return { ...original };
});

import { applyResolution } from "../server/workers/taskOwnershipBackfill.worker.js";
import { resetMetrics, getMetricsSnapshot } from "../server/lib/metrics.js";

afterEach(() => {
  calls.length = 0;
  resetMetrics();
});

const BASE = {
  clinicId: "clinic-1",
  appointmentId: "appt-1",
  rawAcknowledgedBy: "user-a-id",
  acknowledgedAtFromMetadata: null,
  jobId: "job-1",
};

describe("applyResolution — auto-resolve (live mode)", () => {
  it("auto_exact_id writes to vt_appointments and increments the id counter", async () => {
    const out = await applyResolution({
      ...BASE,
      resolution: { source: "auto_exact_id", userId: "user-a-id" },
      dryRun: false,
    });
    expect(out).toEqual({ autoResolved: true, queued: false, skipped: false });
    expect(calls.some((c) => c.method === "update")).toBe(true);
    expect(calls.some((c) => c.method === "set")).toBe(true);
    expect(getMetricsSnapshot().taskOwnership.backfill.autoResolvedById).toBe(1);
  });

  it("auto_exact_clerk_id increments the clerk_id counter", async () => {
    await applyResolution({
      ...BASE,
      resolution: { source: "auto_exact_clerk_id", userId: "user-a-id" },
      dryRun: false,
    });
    expect(getMetricsSnapshot().taskOwnership.backfill.autoResolvedByClerkId).toBe(1);
  });
});

describe("applyResolution — auto-resolve (dryRun)", () => {
  it("dryRun=true increments counter but does NOT update appointments", async () => {
    const out = await applyResolution({
      ...BASE,
      resolution: { source: "auto_exact_id", userId: "user-a-id" },
      dryRun: true,
    });
    expect(out).toEqual({ autoResolved: true, queued: false, skipped: false });
    expect(calls.find((c) => c.method === "update")).toBeUndefined();
    expect(getMetricsSnapshot().taskOwnership.backfill.autoResolvedById).toBe(1);
  });
});

describe("applyResolution — queued outcomes", () => {
  it("queued NO_CANDIDATE inserts into the queue with ON CONFLICT DO NOTHING and increments the correct counter", async () => {
    const out = await applyResolution({
      ...BASE,
      resolution: { source: "queued", reason: "NO_CANDIDATE", candidateUserIds: [] },
      dryRun: false,
    });
    expect(out).toEqual({ autoResolved: false, queued: true, skipped: false });
    expect(calls.some((c) => c.method === "insert")).toBe(true);
    expect(calls.some((c) => c.method === "onConflictDoNothing")).toBe(true);
    expect(getMetricsSnapshot().taskOwnership.backfill.queuedNoCandidate).toBe(1);
  });

  it("queued CROSS_CLINIC_REJECTED increments the cross-clinic counter", async () => {
    await applyResolution({
      ...BASE,
      resolution: { source: "queued", reason: "CROSS_CLINIC_REJECTED", candidateUserIds: [] },
      dryRun: false,
    });
    expect(getMetricsSnapshot().taskOwnership.backfill.queuedCrossClinic).toBe(1);
  });

  it("queued BLOCKED_USER increments the blocked counter", async () => {
    await applyResolution({
      ...BASE,
      resolution: { source: "queued", reason: "BLOCKED_USER", candidateUserIds: ["u"] },
      dryRun: false,
    });
    expect(getMetricsSnapshot().taskOwnership.backfill.queuedBlocked).toBe(1);
  });

  it("queued DELETED_USER increments the deleted counter", async () => {
    await applyResolution({
      ...BASE,
      resolution: { source: "queued", reason: "DELETED_USER", candidateUserIds: ["u"] },
      dryRun: false,
    });
    expect(getMetricsSnapshot().taskOwnership.backfill.queuedDeleted).toBe(1);
  });

  it("queued AMBIGUOUS_MATCH increments the ambiguous counter", async () => {
    await applyResolution({
      ...BASE,
      resolution: { source: "queued", reason: "AMBIGUOUS_MATCH", candidateUserIds: ["u1", "u2"] },
      dryRun: false,
    });
    expect(getMetricsSnapshot().taskOwnership.backfill.queuedAmbiguous).toBe(1);
  });

  it("dryRun=true STILL inserts queue rows (admins must be able to review)", async () => {
    await applyResolution({
      ...BASE,
      resolution: { source: "queued", reason: "NO_CANDIDATE", candidateUserIds: [] },
      dryRun: true,
    });
    expect(calls.some((c) => c.method === "insert")).toBe(true);
    expect(calls.some((c) => c.method === "onConflictDoNothing")).toBe(true);
  });
});

describe("applyResolution — skipped", () => {
  it("EMPTY_RAW_VALUE skipped increments skipped counter and writes nothing", async () => {
    const out = await applyResolution({
      ...BASE,
      resolution: { source: "skipped", reason: "EMPTY_RAW_VALUE" },
      dryRun: false,
    });
    expect(out).toEqual({ autoResolved: false, queued: false, skipped: true });
    expect(calls.length).toBe(0);
    expect(getMetricsSnapshot().taskOwnership.backfill.skipped).toBe(1);
  });
});

describe("applyResolution — ongoing read-path counters are NOT touched", () => {
  it("after auto-resolving a row, task_ownership_typed and task_ownership_string_only remain at 0", async () => {
    await applyResolution({
      ...BASE,
      resolution: { source: "auto_exact_id", userId: "user-a-id" },
      dryRun: false,
    });
    expect(getMetricsSnapshot().taskOwnership.readPath.typed).toBe(0);
    expect(getMetricsSnapshot().taskOwnership.readPath.stringOnly).toBe(0);
  });

  it("after queueing a row, task_ownership_typed and task_ownership_string_only remain at 0", async () => {
    await applyResolution({
      ...BASE,
      resolution: { source: "queued", reason: "NO_CANDIDATE", candidateUserIds: [] },
      dryRun: false,
    });
    expect(getMetricsSnapshot().taskOwnership.readPath.typed).toBe(0);
    expect(getMetricsSnapshot().taskOwnership.readPath.stringOnly).toBe(0);
  });
});
