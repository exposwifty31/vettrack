/**
 * T2 — Admin bypasses the task-create shift-window gate.
 *
 * Owner decision (2026-07): an `admin` actor does not need an active roster
 * shift to create a task. `assertWithinVetShift` (server/services/appointments.service.ts)
 * now accepts an optional `actorRole` and short-circuits before any of its
 * three `OUTSIDE_SHIFT` throws when `actorRole === "admin"`. Non-admin actors
 * must see byte-for-byte unchanged behavior.
 *
 * `assertWithinVetShift` is exported (previously private) specifically for
 * this direct test, following the same pattern as `applyTaskAssignmentEvaluator`
 * elsewhere in this file — it avoids mocking the full `createAppointment`
 * fan-out (audit/realtime/notification/metrics) to exercise the one function
 * that actually owns the OUTSIDE_SHIFT decision.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

type VetRow = { id: string; name: string; displayName: string };
type ShiftRow = { startTime: string; endTime: string; employeeName: string };

const { usersTable, shiftsTable, state } = vi.hoisted(() => ({
  usersTable: {
    id: "users.id",
    name: "users.name",
    displayName: "users.displayName",
    clinicId: "users.clinicId",
    deletedAt: "users.deletedAt",
  },
  shiftsTable: {
    clinicId: "shifts.clinicId",
    date: "shifts.date",
    employeeName: "shifts.employeeName",
    startTime: "shifts.startTime",
    endTime: "shifts.endTime",
  },
  state: {
    vetRows: [] as VetRow[],
    shiftRows: [] as ShiftRow[],
  },
}));

vi.mock("../server/db.js", () => {
  function makeAwaitableRows<T>(rows: T[]) {
    const promise = Promise.resolve(rows) as Promise<T[]> & { limit: (n: number) => Promise<T[]> };
    promise.limit = async (n: number) => rows.slice(0, n);
    return promise;
  }

  const db = {
    select: (_cols: unknown) => ({
      from: (table: unknown) => ({
        where: (_clause: unknown) => {
          if (table === usersTable) return makeAwaitableRows(state.vetRows);
          if (table === shiftsTable) return makeAwaitableRows(state.shiftRows);
          return makeAwaitableRows([]);
        },
      }),
    }),
  };

  return {
    db,
    users: usersTable,
    shifts: shiftsTable,
    appointments: {},
    clinicalCheckIns: {},
    serverConfig: {},
  };
});

import { assertWithinVetShift, AppointmentServiceError } from "../server/services/appointments.service.js";

beforeEach(() => {
  state.vetRows = [];
  state.shiftRows = [];
});

describe("assertWithinVetShift — admin shift-gate bypass (T2)", () => {
  it("admin actor with NO active shift creates a task without throwing OUTSIDE_SHIFT", async () => {
    // Deliberately no matching vet row and no shift row — every non-admin
    // path here throws (VET_NOT_IN_CLINIC or OUTSIDE_SHIFT). Resolving
    // cleanly proves the admin short-circuit runs before any DB lookup.
    state.vetRows = [];
    state.shiftRows = [];

    await expect(
      assertWithinVetShift({
        clinicId: "clinic-1",
        vetId: "vet-1",
        startTime: new Date("2026-07-10T09:00:00.000Z"),
        endTime: new Date("2026-07-10T10:00:00.000Z"),
        actorRole: "admin",
      }),
    ).resolves.toBeUndefined();
  });

  it("admin actor bypasses even the cross-day OUTSIDE_SHIFT check", async () => {
    await expect(
      assertWithinVetShift({
        clinicId: "clinic-1",
        vetId: "vet-1",
        startTime: new Date("2026-07-10T23:00:00.000Z"),
        endTime: new Date("2026-07-11T01:00:00.000Z"),
        actorRole: "admin",
      }),
    ).resolves.toBeUndefined();
  });

  it("non-admin (vet) actor outside shift hours STILL throws OUTSIDE_SHIFT", async () => {
    state.vetRows = [{ id: "vet-1", name: "Dr Vet", displayName: "Dr Vet" }];
    state.shiftRows = []; // no roster shift covers this window

    const err = await assertWithinVetShift({
      clinicId: "clinic-1",
      vetId: "vet-1",
      startTime: new Date("2026-07-10T09:00:00.000Z"),
      endTime: new Date("2026-07-10T10:00:00.000Z"),
      actorRole: "vet",
    }).catch((e) => e);

    expect(err).toBeInstanceOf(AppointmentServiceError);
    expect((err as InstanceType<typeof AppointmentServiceError>).code).toBe("OUTSIDE_SHIFT");
    expect((err as InstanceType<typeof AppointmentServiceError>).status).toBe(400);
  });

  it("non-admin (technician) actor outside shift hours STILL throws OUTSIDE_SHIFT", async () => {
    state.vetRows = [{ id: "vet-1", name: "Dr Vet", displayName: "Dr Vet" }];
    state.shiftRows = [];

    await expect(
      assertWithinVetShift({
        clinicId: "clinic-1",
        vetId: "vet-1",
        startTime: new Date("2026-07-10T09:00:00.000Z"),
        endTime: new Date("2026-07-10T10:00:00.000Z"),
        actorRole: "technician",
      }),
    ).rejects.toMatchObject({ code: "OUTSIDE_SHIFT" });
  });

  it("no actorRole (system/backfill caller) preserves original unbypassed behavior", async () => {
    state.vetRows = [{ id: "vet-1", name: "Dr Vet", displayName: "Dr Vet" }];
    state.shiftRows = [];

    await expect(
      assertWithinVetShift({
        clinicId: "clinic-1",
        vetId: "vet-1",
        startTime: new Date("2026-07-10T09:00:00.000Z"),
        endTime: new Date("2026-07-10T10:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "OUTSIDE_SHIFT" });
  });

  it("non-admin actor within an active shift window resolves without throwing", async () => {
    state.vetRows = [{ id: "vet-1", name: "Dr Vet", displayName: "Dr Vet" }];
    state.shiftRows = [{ startTime: "08:00", endTime: "18:00", employeeName: "Dr Vet" }];

    await expect(
      assertWithinVetShift({
        clinicId: "clinic-1",
        vetId: "vet-1",
        startTime: new Date("2026-07-10T09:00:00.000Z"),
        endTime: new Date("2026-07-10T10:00:00.000Z"),
        actorRole: "vet",
      }),
    ).resolves.toBeUndefined();
  });
});
