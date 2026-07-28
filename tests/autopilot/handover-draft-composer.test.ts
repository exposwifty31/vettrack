import { describe, it, expect } from "vitest";
import {
  composeHandoverDraftProposal,
  type HandoverDraftContent,
} from "../../server/lib/autopilot/handover-draft-composer.js";
import type { ShiftHandoverDeltas } from "../../server/lib/shift-handover.js";
import type { ShiftWindow } from "../../server/lib/shift-handover-generator.js";

const CLINIC_A = "clinic-a";
const SESSION_A = "session-1";
const WINDOW: ShiftWindow = {
  start: new Date("2026-07-22T06:00:00.000Z"),
  end: new Date("2026-07-22T14:00:00.000Z"),
};

/**
 * Mirrors how `aggregateDeltas` actually populates `sourceId`:
 *   - audit-sourced entries: `auditLogs.id`, a `randomUUID()` text id (always
 *     hyphenated, never pure digits).
 *   - outbox-sourced entries: `String(eventOutbox.id)`, a `bigserial` id
 *     stringified (always pure digits).
 */
function buildDeltas(overrides: Partial<ShiftHandoverDeltas> = {}): ShiftHandoverDeltas {
  return {
    custody: [
      {
        sourceId: "a1b2c3d4-0000-0000-0000-000000000001",
        kind: "equipment_checked_out",
        targetId: "eq-1",
        targetType: "equipment",
        at: "2026-07-22T07:00:00.000Z",
      },
    ],
    taskState: [
      {
        sourceId: "42",
        kind: "TASK_UPDATED",
        targetId: "task-1",
        targetType: "task",
        at: "2026-07-22T08:00:00.000Z",
      },
    ],
    alerts: [],
    dispenses: [],
    ...overrides,
  };
}

describe("composeHandoverDraftProposal", () => {
  it("sets kind, sourceSessionId, clinicId correctly", () => {
    const input = composeHandoverDraftProposal({
      clinicId: CLINIC_A,
      shiftSessionId: SESSION_A,
      window: WINDOW,
      deltas: buildDeltas(),
      locale: "en",
    });

    expect(input.kind).toBe("shift_handover_draft");
    expect(input.sourceSessionId).toBe(SESSION_A);
    expect(input.clinicId).toBe(CLINIC_A);
  });

  it("emits exactly one citedFacts entry per delta entry", () => {
    const deltas = buildDeltas({
      alerts: [
        {
          sourceId: "b2c3d4e5-0000-0000-0000-000000000002",
          kind: "alert_acknowledged",
          targetId: "alert-1",
          targetType: "alert",
          at: "2026-07-22T09:00:00.000Z",
        },
      ],
    });
    const totalEntries =
      deltas.custody.length + deltas.taskState.length + deltas.alerts.length + deltas.dispenses.length;

    const input = composeHandoverDraftProposal({
      clinicId: CLINIC_A,
      shiftSessionId: SESSION_A,
      window: WINDOW,
      deltas,
      locale: "en",
    });

    expect(input.citedFacts).toHaveLength(totalEntries);
  });

  it("cites an audit-sourced entry (UUID sourceId) against vt_audit_logs", () => {
    const input = composeHandoverDraftProposal({
      clinicId: CLINIC_A,
      shiftSessionId: SESSION_A,
      window: WINDOW,
      deltas: buildDeltas(),
      locale: "en",
    });

    expect(input.citedFacts).toContainEqual(
      expect.objectContaining({
        sourceId: "a1b2c3d4-0000-0000-0000-000000000001",
        sourceTable: "vt_audit_logs",
        kind: "equipment_checked_out",
      }),
    );
  });

  it("cites an outbox-sourced entry (pure-digit sourceId) against vt_event_outbox", () => {
    const input = composeHandoverDraftProposal({
      clinicId: CLINIC_A,
      shiftSessionId: SESSION_A,
      window: WINDOW,
      deltas: buildDeltas(),
      locale: "en",
    });

    expect(input.citedFacts).toContainEqual(
      expect.objectContaining({
        sourceId: "42",
        sourceTable: "vt_event_outbox",
        kind: "TASK_UPDATED",
      }),
    );
  });

  it("summary is composed via typed i18n keys, not hardcoded strings — en and he differ", () => {
    const en = composeHandoverDraftProposal({
      clinicId: CLINIC_A,
      shiftSessionId: SESSION_A,
      window: WINDOW,
      deltas: buildDeltas(),
      locale: "en",
    });
    expect(en.summary.length).toBeGreaterThan(0);
    expect(en.summary).not.toContain("undefined");

    const he = composeHandoverDraftProposal({
      clinicId: CLINIC_A,
      shiftSessionId: SESSION_A,
      window: WINDOW,
      deltas: buildDeltas(),
      locale: "he",
    });
    expect(he.summary).not.toBe(en.summary);
  });

  it("draftContent carries the deltas artifact shape unchanged, plus the derived openItems", () => {
    const deltas = buildDeltas();
    const input = composeHandoverDraftProposal({
      clinicId: CLINIC_A,
      shiftSessionId: SESSION_A,
      window: WINDOW,
      deltas,
      locale: "en",
    });

    const draft = input.draftContent as HandoverDraftContent;
    expect(draft.deltas).toEqual(deltas);
    expect(draft.shiftSessionId).toBe(SESSION_A);
    expect(draft.windowStart).toBe(WINDOW.start.toISOString());
    expect(draft.windowEnd).toBe(WINDOW.end.toISOString());
    // taskState entry ("TASK_UPDATED") is non-terminal -> stays open
    expect(draft.openItems).toEqual([{ id: "task-1", kind: "task", summary: "TASK_UPDATED:task-1" }]);
  });

  it("R-SH-F1 parity: composes a valid (empty-citations) proposal even when there are zero deltas — never skipped", () => {
    const emptyDeltas: ShiftHandoverDeltas = { custody: [], taskState: [], alerts: [], dispenses: [] };
    const input = composeHandoverDraftProposal({
      clinicId: CLINIC_A,
      shiftSessionId: SESSION_A,
      window: WINDOW,
      deltas: emptyDeltas,
      locale: "en",
    });

    expect(input.kind).toBe("shift_handover_draft");
    expect(input.citedFacts).toEqual([]);
    expect(input.summary.length).toBeGreaterThan(0);
    const draft = input.draftContent as HandoverDraftContent;
    expect(draft.openItems).toEqual([]);
  });
});
