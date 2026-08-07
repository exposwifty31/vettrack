/**
 * Full role × action contract for `canPerformTaskAction` — pins the
 * owner-approved hierarchical policy (2026-08-07): senior roles are a strict
 * superset of the technician tier, and the alias tiers (lead_technician,
 * vet_tech — see ROLE_HIERARCHY) are no longer denied everything. Students
 * stay fully denied: the web client routes them away from task UI
 * (src/pages/Tasks.tsx), so not even read is granted.
 */

import { describe, expect, it } from "vitest";
import { canPerformTaskAction, type TaskAction } from "../server/lib/task-rbac.js";

const ALL_ACTIONS: readonly TaskAction[] = [
  "task.read",
  "task.create",
  "task.assign",
  "task.reassign",
  "task.cancel",
  "task.start",
  "task.complete",
];

const ALL_ALLOWED: Record<TaskAction, boolean> = {
  "task.read": true,
  "task.create": true,
  "task.assign": true,
  "task.reassign": true,
  "task.cancel": true,
  "task.start": true,
  "task.complete": true,
};

const LIFECYCLE_ONLY: Record<TaskAction, boolean> = {
  "task.read": true,
  "task.create": false,
  "task.assign": false,
  "task.reassign": false,
  "task.cancel": false,
  "task.start": true,
  "task.complete": true,
};

const NOTHING: Record<TaskAction, boolean> = {
  "task.read": false,
  "task.create": false,
  "task.assign": false,
  "task.reassign": false,
  "task.cancel": false,
  "task.start": false,
  "task.complete": false,
};

const ROLE_MATRIX: Record<string, Record<TaskAction, boolean>> = {
  admin: ALL_ALLOWED,
  vet: ALL_ALLOWED,
  senior_technician: ALL_ALLOWED,
  lead_technician: ALL_ALLOWED,
  technician: LIFECYCLE_ONLY,
  vet_tech: LIFECYCLE_ONLY,
  student: NOTHING,
};

describe("canPerformTaskAction — full role × action matrix", () => {
  for (const [role, expected] of Object.entries(ROLE_MATRIX)) {
    for (const action of ALL_ACTIONS) {
      it(`${role} ${expected[action] ? "allows" : "denies"} ${action}`, () => {
        expect(canPerformTaskAction(role, action)).toBe(expected[action]);
      });
    }
  }
});

describe("canPerformTaskAction — hierarchy invariants", () => {
  it("every action a technician can perform, vet / senior_technician / lead_technician can also perform", () => {
    for (const action of ALL_ACTIONS) {
      if (!canPerformTaskAction("technician", action)) continue;
      for (const senior of ["vet", "senior_technician", "lead_technician"]) {
        expect(canPerformTaskAction(senior, action)).toBe(true);
      }
    }
  });

  it("vet_tech matches its tier-20 peer technician on every action", () => {
    for (const action of ALL_ACTIONS) {
      expect(canPerformTaskAction("vet_tech", action)).toBe(
        canPerformTaskAction("technician", action),
      );
    }
  });

  it("lead_technician matches senior_technician on every action (alias tier)", () => {
    for (const action of ALL_ACTIONS) {
      expect(canPerformTaskAction("lead_technician", action)).toBe(
        canPerformTaskAction("senior_technician", action),
      );
    }
  });
});

describe("canPerformTaskAction — normalization and deny-by-default", () => {
  it("normalizes case and whitespace", () => {
    expect(canPerformTaskAction("  VET  ", "task.start")).toBe(true);
    expect(canPerformTaskAction("Lead_Technician", "task.assign")).toBe(true);
  });

  it("legacy 'viewer' aliases to student → deny everything", () => {
    for (const action of ALL_ACTIONS) {
      expect(canPerformTaskAction("viewer", action)).toBe(false);
      expect(canPerformTaskAction("Viewer", action)).toBe(false);
    }
  });

  it("null / undefined / empty / unknown roles → deny everything", () => {
    for (const action of ALL_ACTIONS) {
      expect(canPerformTaskAction(null, action)).toBe(false);
      expect(canPerformTaskAction(undefined, action)).toBe(false);
      expect(canPerformTaskAction("", action)).toBe(false);
      expect(canPerformTaskAction("intruder_role", action)).toBe(false);
    }
  });
});
