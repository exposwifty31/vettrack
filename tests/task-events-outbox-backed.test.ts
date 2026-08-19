/**
 * Audit lane T1 — TASK_* and AUTOMATION_TRIGGERED must be outbox-backed.
 *
 * CLAUDE.md ("Frozen architecture surfaces") documents the realtime transport as
 * SSE with outbox-backed ordering on `vt_event_outbox`, a monotonic `id:` cursor,
 * and HTTP replay via `GET /api/realtime/replay`. The only sanctioned exception is
 * the ephemeral `/collab-ws` collab channel.
 *
 * Task lifecycle events were emitted exclusively through the legacy in-memory
 * `broadcast()` in `server/lib/realtime.ts` (its own header: "legacy path to be
 * removed after full outbox migration is confirmed"). Those rows never reached
 * `vt_event_outbox`, so they had no durability and no replay coverage — a client
 * that reconnected silently missed every task event. For AUTOMATION_TRIGGERED it
 * was worse: `scanAndEnqueueAutomationJobs` runs only in the notification worker
 * process, which holds no SSE connections, so those broadcasts reached zero
 * clients. The outbox fixes both. It is NOT cross-instance fan-out —
 * `outboxEmitter` is an in-process EventEmitter with no Redis adapter, so with
 * multiple API replicas only the claiming replica emits the live frame.
 *
 * These tests pin BOTH halves of the fix:
 *   1. the events go through `insertRealtimeDomainEvent` (outbox), and
 *   2. they are NOT also pushed through `broadcast()` — dual-emission would
 *      double-deliver to every client on `GET /api/realtime/stream`, which
 *      registers with the legacy `clientsByClinic` registry AND the
 *      outboxEmitter at the same time.
 *
 * No database is touched: `server/db.js` and the outbox helper are module-mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

type Row = Record<string, unknown>;

const { state, tables } = vi.hoisted(() => ({
  state: {
    // appointments.service.ts: db.select()...limit(1)
    selectRows: [] as Row[],
    // appointments.service.ts: db.update()...returning()
    updateRows: [] as Row[],
    // task-automation.service.ts: db.select()...orderBy().limit(BATCH)
    scanRows: [] as Row[],
  },
  tables: {
    appointments: {
      id: "appointments.id",
      clinicId: "appointments.clinicId",
      status: "appointments.status",
      endTime: "appointments.endTime",
      startTime: "appointments.startTime",
      createdAt: "appointments.createdAt",
      updatedAt: "appointments.updatedAt",
      vetId: "appointments.vetId",
      escalatedAt: "appointments.escalatedAt",
      stuckNotifiedAt: "appointments.stuckNotifiedAt",
      prestartReminderAt: "appointments.prestartReminderAt",
    },
    users: {
      id: "users.id",
      role: "users.role",
      clinicId: "users.clinicId",
      status: "users.status",
      deletedAt: "users.deletedAt",
    },
  },
}));

vi.mock("../server/db.js", () => {
  const db = {
    select: (_cols?: unknown) => ({
      from: (_table: unknown) => ({
        where: (_clause: unknown) => ({
          limit: async (_n: number) => state.selectRows,
          orderBy: (_o: unknown) => ({
            limit: async (_n: number) => state.scanRows,
          }),
        }),
      }),
    }),
    update: (_table: unknown) => ({
      set: (_values: unknown) => ({
        where: (_clause: unknown) => ({
          returning: async () => state.updateRows,
        }),
      }),
    }),
  };
  return {
    db,
    appointments: tables.appointments,
    users: tables.users,
    clinicalCheckIns: {},
    shifts: {},
    eventOutbox: {},
  };
});

const logAudit = vi.fn();
vi.mock("../server/lib/audit.js", () => ({
  logAudit: (...args: unknown[]) => logAudit(...args),
  resolveAuditActorRole: () => "technician",
}));

vi.mock("../server/lib/task-notification.js", () => ({
  sendTaskNotification: vi.fn(async () => undefined),
}));

vi.mock("../server/lib/shift-chat-presence.js", () => ({
  postSystemMessage: vi.fn(async () => undefined),
}));

vi.mock("../server/lib/idempotency.js", () => ({
  checkIdempotentAsync: vi.fn(async () => false),
  markIdempotentAsync: vi.fn(async () => undefined),
}));

vi.mock("../server/lib/queue.js", () => ({
  enqueueAutomationExecuteJob: vi.fn(async () => undefined),
  enqueueAutomationNotificationJobs: vi.fn(async () => undefined),
}));

// The two spies this lane is actually about.
const broadcast = vi.fn();
vi.mock("../server/lib/realtime.js", () => ({
  broadcast: (...args: unknown[]) => broadcast(...args),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}));

const insertRealtimeDomainEvent = vi.fn(async () => 1);
vi.mock("../server/lib/realtime-outbox.js", () => ({
  insertRealtimeDomainEvent: (...args: unknown[]) => insertRealtimeDomainEvent(...args),
}));

import { cancelAppointment } from "../server/services/appointments.service.js";
import { scanAndEnqueueAutomationJobs } from "../server/services/task-automation.service.js";

const CLINIC = "clinic-t1";

function appointmentRow(overrides: Row = {}): Row {
  const now = new Date("2026-01-01T10:00:00.000Z");
  return {
    id: "task-1",
    clinicId: CLINIC,
    vetId: "user-1",
    status: "assigned",
    notes: null,
    metadata: null,
    priority: "normal",
    taskType: "equipment_prep",
    containerId: null,
    appointmentType: null,
    createdBy: "user-1",
    startTime: now,
    endTime: now,
    scheduledAt: null,
    completedAt: null,
    conflictOverride: false,
    overrideReason: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** Only the calls this lane owns — other emitters in the same process are irrelevant. */
function taskOutboxCalls(): Array<{ clinicId: string; type: string; payload: unknown }> {
  return insertRealtimeDomainEvent.mock.calls
    .map((c) => (c as unknown[])[1] as { clinicId: string; type: string; payload: unknown })
    .filter((p) => p && (p.type.startsWith("TASK_") || p.type === "AUTOMATION_TRIGGERED"));
}

function legacyBroadcastTaskTypes(): string[] {
  return broadcast.mock.calls
    .map((c) => (c as unknown[])[1] as { type?: string } | undefined)
    .map((e) => e?.type ?? "")
    .filter((t) => t.startsWith("TASK_") || t === "AUTOMATION_TRIGGERED");
}

beforeEach(() => {
  broadcast.mockClear();
  insertRealtimeDomainEvent.mockClear();
  logAudit.mockClear();
  state.selectRows = [];
  state.updateRows = [];
  state.scanRows = [];
});

describe("appointments.service — task lifecycle events are outbox-backed", () => {
  it("cancelAppointment writes TASK_CANCELLED + TASK_UPDATED to the outbox", async () => {
    state.selectRows = [appointmentRow()];
    state.updateRows = [appointmentRow({ status: "cancelled" })];

    await cancelAppointment(CLINIC, "task-1", "no longer needed", {
      userId: "user-1",
      email: "tech@example.com",
      role: "technician",
    });

    const emitted = taskOutboxCalls();
    expect(emitted.map((e) => e.type)).toEqual(["TASK_CANCELLED", "TASK_UPDATED"]);
    for (const e of emitted) {
      expect(e.clinicId).toBe(CLINIC);
      expect((e.payload as { id: string }).id).toBe("task-1");
      expect((e.payload as { status: string }).status).toBe("cancelled");
    }
  });

  it("cancelAppointment does NOT also push through the legacy in-memory broadcast", async () => {
    state.selectRows = [appointmentRow()];
    state.updateRows = [appointmentRow({ status: "cancelled" })];

    await cancelAppointment(CLINIC, "task-1", undefined, undefined);

    expect(legacyBroadcastTaskTypes()).toEqual([]);
  });

  it("a failing outbox insert never fails the clinical mutation", async () => {
    state.selectRows = [appointmentRow()];
    state.updateRows = [appointmentRow({ status: "cancelled" })];
    insertRealtimeDomainEvent.mockRejectedValueOnce(new Error("outbox down"));

    await expect(cancelAppointment(CLINIC, "task-1", undefined, undefined)).resolves.toMatchObject({
      id: "task-1",
      status: "cancelled",
    });
  });
});

describe("task-automation.service — AUTOMATION_TRIGGERED is outbox-backed", () => {
  it("scan emits AUTOMATION_TRIGGERED through the outbox, never through broadcast", async () => {
    const prev = process.env.ENABLE_AUTOMATION_ENGINE;
    process.env.ENABLE_AUTOMATION_ENGINE = "true";
    try {
      state.scanRows = [{ id: "task-9", clinicId: CLINIC }];
      await scanAndEnqueueAutomationJobs();
    } finally {
      if (prev === undefined) delete process.env.ENABLE_AUTOMATION_ENGINE;
      else process.env.ENABLE_AUTOMATION_ENGINE = prev;
    }

    const emitted = taskOutboxCalls();
    // four rules: overdue_escalation, auto_assign_unassigned, stuck_recovery, prestart_reminder
    expect(emitted).toHaveLength(4);
    expect(new Set(emitted.map((e) => e.type))).toEqual(new Set(["AUTOMATION_TRIGGERED"]));
    expect(emitted.map((e) => (e.payload as { rule: string }).rule)).toEqual([
      "overdue_escalation",
      "auto_assign_unassigned",
      "stuck_recovery",
      "prestart_reminder",
    ]);
    for (const e of emitted) expect(e.clinicId).toBe(CLINIC);
    expect(legacyBroadcastTaskTypes()).toEqual([]);
  });
});

describe("no legacy broadcast emitters remain in the task services", () => {
  const files = [
    "server/services/appointments.service.ts",
    "server/services/task-automation.service.ts",
  ];

  it.each(files)("%s does not import or call broadcast()", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).not.toMatch(/from\s+"\.\.\/lib\/realtime\.js"/);
    expect(source).not.toMatch(/\bbroadcast\s*\(/);
  });

  /**
   * Class guard, not an instance guard. A two-file allowlist would let a
   * thirteenth emit site reopen the defect in a NEW file and still pass, so this
   * walks every `.ts` under `server/` and allows `broadcast(` only in the file
   * that defines it. Delete this test only together with `broadcast()` itself.
   */
  it("no file under server/ calls broadcast() except the file that defines it", () => {
    const DEFINITION_FILE = "server/lib/realtime.ts";
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(full);
        return entry.isFile() && full.endsWith(".ts") ? [full] : [];
      });

    const offenders = walk("server")
      .filter((file) => file !== DEFINITION_FILE)
      .filter((file) => /\bbroadcast\s*\(/.test(readFileSync(file, "utf8")));

    expect(
      offenders,
      `These files call the legacy in-memory broadcast(). Domain events must go through ` +
        `insertRealtimeDomainEvent (vt_event_outbox) so they carry an id: cursor and are replayable:\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("appointments.service emits all five TASK_* kinds via the outbox helper", () => {
    const source = readFileSync("server/services/appointments.service.ts", "utf8");
    expect(source).toContain("insertRealtimeDomainEvent");
    for (const type of [
      "TASK_CREATED",
      "TASK_UPDATED",
      "TASK_CANCELLED",
      "TASK_STARTED",
      "TASK_COMPLETED",
    ]) {
      expect(source).toContain(`"${type}"`);
    }
  });
});
