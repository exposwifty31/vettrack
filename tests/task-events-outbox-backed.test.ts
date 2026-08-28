/**
 * Audit lane T1 — TASK_* and AUTOMATION_TRIGGERED must be outbox-backed.
 *
 * CLAUDE.md ("Frozen architecture surfaces") documents the realtime transport as
 * SSE with outbox-backed ordering on `vt_event_outbox`, a monotonic `id:` cursor,
 * and HTTP replay via `GET /api/realtime/replay`. The only sanctioned exception is
 * the ephemeral `/collab-ws` collab channel.
 *
 * Task lifecycle events were emitted exclusively through the legacy in-memory
 * `broadcast()` that used to live in `server/lib/realtime.ts`. Those rows never
 * reached `vt_event_outbox`, so they had no durability and no replay coverage —
 * a client that reconnected silently missed every task event. For
 * AUTOMATION_TRIGGERED it was worse: `scanAndEnqueueAutomationJobs` runs only in
 * the notification worker process, which holds no SSE connections, so those
 * broadcasts reached zero clients. The outbox fixes both. It is NOT
 * cross-instance fan-out — `outboxEmitter` is an in-process EventEmitter with no
 * Redis adapter, so with multiple API replicas only the claiming replica emits
 * the live frame.
 *
 * `broadcast()` itself is gone now (zero callers repo-wide, removed alongside
 * the dual-emission guard tests that used to live here — see git history if you
 * need them). What's left pins the half that's still load-bearing: task events
 * go through `insertRealtimeDomainEvent` (outbox), in the right order, from the
 * one helper that tags them `category: "TASK"`.
 *
 * No database is touched: `server/db.js` and the outbox helper are module-mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import ts from "typescript";
import { readFileSync } from "fs";

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

// The spy this lane is actually about.
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


beforeEach(() => {
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
  it("scan emits AUTOMATION_TRIGGERED through the outbox", async () => {
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
  });
});

describe("appointments.service — outbox emission is exclusive and ordered", () => {
  /**
   * Per-operation, not per-file. The previous version of this test read the whole
   * source and asserted the five type literals appeared SOMEWHERE in it, which passes
   * unchanged if createAppointment, updateAppointment, startTask or completeTask stops
   * calling the emitter altogether — the literals would still be present in the other
   * operations. It proved the strings exist, not that the events fire.
   *
   * This walks the AST and extracts the emitTaskEvent(...) calls inside each named
   * function body, in source order, so a lost or reordered emission fails here.
   */
  // createAppointment/updateAppointment/cancelAppointment live in
  // scheduling.service.ts; startTask/completeTask live in
  // task-lifecycle.service.ts (ADR-002 split — see
  // docs/architecture/adr-002-appointments-service-split.md). Parsing the
  // concatenation as one synthetic source is sufficient here: this walk only
  // matches function declarations by name and call expressions inside them,
  // never type-checks, so the original-file boundary is irrelevant to it.
  function serviceSource(): string {
    return [
      readFileSync("server/services/scheduling.service.ts", "utf8"),
      readFileSync("server/services/task-lifecycle.service.ts", "utf8"),
    ].join("\n");
  }

  function emitSequenceFor(fnName: string): Array<{ type: string; firstArg: string }> {
    const source = serviceSource();
    const sf = ts.createSourceFile(
      "appointments.service.ts",
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    const found: Array<{ type: string; firstArg: string }> = [];
    let inside = false;

    const collect = (node: ts.Node): void => {
      if (
        inside &&
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "emitTaskEvent"
      ) {
        const [arg0, arg1] = node.arguments;
        found.push({
          type: arg1 && ts.isStringLiteral(arg1) ? arg1.text : "<non-literal>",
          firstArg: arg0 && ts.isIdentifier(arg0) ? arg0.text : "<non-identifier>",
        });
      }
      ts.forEachChild(node, collect);
    };

    const visit = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name?.text === fnName) {
        inside = true;
        if (node.body) ts.forEachChild(node.body, collect);
        inside = false;
        return;
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sf, visit);
    return found;
  }

  it.each([
    ["createAppointment", ["TASK_CREATED"]],
    ["updateAppointment", ["TASK_UPDATED"]],
    // The two paired emitters: the state change first, then the generic TASK_UPDATED
    // that list views subscribe to. Order matters — the outbox id sequence is what the
    // client applies them in, so a swap would show the row updated before it cancelled.
    ["cancelAppointment", ["TASK_CANCELLED", "TASK_UPDATED"]],
    ["startTask", ["TASK_STARTED", "TASK_UPDATED"]],
    ["completeTask", ["TASK_COMPLETED", "TASK_UPDATED"]],
  ] as const)("%s emits %j through the outbox helper, in that order", (fn, expected) => {
    const seq = emitSequenceFor(fn);
    expect(
      seq.map((e) => e.type),
      `${fn} no longer emits the expected task events in order`,
    ).toEqual([...expected]);
    // Every emission must be scoped by the resolved clinicId local, never a raw
    // request field — the multi-tenancy rule that applies to every write path.
    for (const e of seq) expect(e.firstArg).toBe("clinicId");
  });

  /**
   * Structural, not line-based. The previous version filtered source LINES containing
   * `insertRealtimeDomainEvent(` and asserted the single hit also contained
   * `category: "TASK"` on that same line. Two ways that lies: prettier splitting the
   * call across lines breaks it without any behaviour changing, and — the one that
   * matters — a call MOVED out of `emitTaskEvent` into another function still passes,
   * which is precisely the claim in this test's name.
   *
   * This walks the AST for `insertRealtimeDomainEvent` call expressions and records the
   * function each one sits in, so both the count and the containment are real.
   */
  function directOutboxCalls(): Array<{ enclosingFunction: string | null; category: string | null }> {
    const source = serviceSource();
    const sf = ts.createSourceFile(
      "appointments.service.ts",
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    const found: Array<{ enclosingFunction: string | null; category: string | null }> = [];

    const walk = (node: ts.Node, enclosing: string | null): void => {
      let current = enclosing;
      if (ts.isFunctionDeclaration(node) && node.name) current = node.name.text;
      else if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      ) {
        current = node.name.text;
      } else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
        current = node.name.text;
      }

      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "insertRealtimeDomainEvent"
      ) {
        const options = node.arguments[1];
        const categoryProp = options && ts.isObjectLiteralExpression(options)
          ? options.properties.find(
              (prop) =>
                ts.isPropertyAssignment(prop) &&
                ts.isIdentifier(prop.name) &&
                prop.name.text === "category",
            )
          : undefined;
        found.push({
          enclosingFunction: current,
          category:
            categoryProp &&
            ts.isPropertyAssignment(categoryProp) &&
            ts.isStringLiteral(categoryProp.initializer)
              ? categoryProp.initializer.text
              : null,
        });
      }

      ts.forEachChild(node, (child) => walk(child, current));
    };
    ts.forEachChild(sf, (node) => walk(node, null));
    return found;
  }

  it("emitTaskEvent is the only path from this service to the outbox", () => {
    // A future emit site calling insertRealtimeDomainEvent directly would bypass the
    // helper's category:"TASK" tagging and its non-fatal error handling, so the
    // per-operation sequences above would stop covering it.
    const calls = directOutboxCalls();
    expect(
      calls.map((c) => c.enclosingFunction),
      `appointments.service.ts must reach the outbox only through emitTaskEvent; ` +
        `found calls in: ${calls.map((c) => c.enclosingFunction ?? "<top level>").join(", ")}`,
    ).toEqual(["emitTaskEvent"]);
    expect(calls[0]!.category, `the single outbox call must tag category "TASK"`).toBe("TASK");
  });
});
