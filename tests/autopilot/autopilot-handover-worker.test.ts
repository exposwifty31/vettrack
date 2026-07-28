import { describe, it, expect, vi } from "vitest";
import { runHandoverDraftScan } from "../../server/workers/autopilotHandoverDraftWorker.js";
import { InMemoryActionProposalWriter } from "../../server/lib/autopilot/action-proposal-writer.port.js";
import type { ShiftHandoverDeltas } from "../../server/lib/shift-handover.js";
import type { ShiftWindow } from "../../server/lib/shift-handover-generator.js";

vi.mock("../../server/lib/audit.js", () => ({ logAudit: vi.fn() }));
vi.mock("../../server/lib/metrics.js", () => ({ incrementMetric: vi.fn() }));

const CLINIC_A = "clinic-a";
const NOW = new Date("2026-07-22T09:00:00.000Z");

const WINDOW: ShiftWindow = {
  start: new Date("2026-07-22T00:00:00.000Z"),
  end: new Date("2026-07-22T08:00:00.000Z"),
};

const DELTAS_WITH_ENTRIES: ShiftHandoverDeltas = {
  custody: [
    {
      sourceId: "a1b2c3d4-0000-0000-0000-000000000001",
      kind: "equipment_checked_out",
      targetId: "eq-1",
      targetType: "equipment",
      at: "2026-07-22T02:00:00.000Z",
    },
  ],
  taskState: [],
  alerts: [],
  dispenses: [],
};

const EMPTY_DELTAS: ShiftHandoverDeltas = { custody: [], taskState: [], alerts: [], dispenses: [] };

function buildDeps(overrides: {
  sessions?: Array<{ id: string; clinicId: string }>;
  deltasBySessionId?: Record<string, ShiftHandoverDeltas>;
  writer?: InMemoryActionProposalWriter;
}) {
  const writer = overrides.writer ?? new InMemoryActionProposalWriter();
  const sessions = overrides.sessions ?? [{ id: "session-1", clinicId: CLINIC_A }];
  const deltasBySessionId = overrides.deltasBySessionId ?? { "session-1": DELTAS_WITH_ENTRIES };

  // resolveWindow doesn't carry the sessionId through in this fixture, so
  // readDeltas keys off the LAST-resolved session id (single-clinic tests
  // only need one lookup at a time; the multi-session test below tracks it
  // via a small closure instead).
  let lastResolvedSessionId: string | null = null;

  return {
    writer,
    deps: {
      writer,
      findRecentlyEndedSessions: async () => sessions,
      resolveWindow: async (_clinicId: string, sessionId: string) => {
        lastResolvedSessionId = sessionId;
        return WINDOW;
      },
      readDeltas: async () => deltasBySessionId[lastResolvedSessionId ?? ""] ?? EMPTY_DELTAS,
    },
  };
}

describe("autopilotHandoverDraftWorker.runHandoverDraftScan", () => {
  it("stages exactly one shift_handover_draft proposal for an ended session with deltas", async () => {
    const { writer, deps } = buildDeps({});

    const result = await runHandoverDraftScan(deps, NOW);

    expect(result).toEqual({ scanned: 1, staged: 1 });
    const staged = await writer.findStaged(CLINIC_A, { kind: "shift_handover_draft" });
    expect(staged).toHaveLength(1);
    expect(staged[0]?.sourceSessionId).toBe("session-1");
  });

  it("does not double-stage on a second scan of the same session, and does not emit a duplicate audit/metric", async () => {
    const { logAudit } = await import("../../server/lib/audit.js");
    const { incrementMetric } = await import("../../server/lib/metrics.js");
    vi.mocked(logAudit).mockClear();
    vi.mocked(incrementMetric).mockClear();

    const { writer, deps } = buildDeps({});

    await runHandoverDraftScan(deps, NOW);
    const second = await runHandoverDraftScan(deps, NOW);

    expect(second.staged).toBe(0);
    const staged = await writer.findStaged(CLINIC_A, { kind: "shift_handover_draft" });
    expect(staged).toHaveLength(1);
    expect(
      vi.mocked(incrementMetric).mock.calls.filter(([name]) => name === "autopilot_proposal_staged_total"),
    ).toHaveLength(1);
    expect(
      vi.mocked(logAudit).mock.calls.filter(([entry]) => entry.actionType === "action_proposal_staged"),
    ).toHaveLength(1);
  });

  it("R-SH-F1 parity: a session with ZERO deltas still gets a staged (empty) handover draft — never silently skipped", async () => {
    const { writer, deps } = buildDeps({ deltasBySessionId: { "session-1": EMPTY_DELTAS } });

    const result = await runHandoverDraftScan(deps, NOW);

    expect(result).toEqual({ scanned: 1, staged: 1 });
    const staged = await writer.findStaged(CLINIC_A, { kind: "shift_handover_draft" });
    expect(staged).toHaveLength(1);
    expect(staged[0]?.citedFacts).toEqual([]);
  });

  it("scans multiple ended sessions across clinics independently", async () => {
    const { writer, deps } = buildDeps({
      sessions: [
        { id: "session-1", clinicId: CLINIC_A },
        { id: "session-2", clinicId: "clinic-b" },
      ],
      deltasBySessionId: { "session-1": DELTAS_WITH_ENTRIES, "session-2": EMPTY_DELTAS },
    });

    const result = await runHandoverDraftScan(deps, NOW);

    expect(result).toEqual({ scanned: 2, staged: 2 });
    expect(await writer.findStaged(CLINIC_A, { kind: "shift_handover_draft" })).toHaveLength(1);
    expect(await writer.findStaged("clinic-b", { kind: "shift_handover_draft" })).toHaveLength(1);
  });

  it("stages nothing when there are no recently-ended sessions", async () => {
    const { writer, deps } = buildDeps({ sessions: [] });

    const result = await runHandoverDraftScan(deps, NOW);

    expect(result).toEqual({ scanned: 0, staged: 0 });
    expect(await writer.findStaged(CLINIC_A, { kind: "shift_handover_draft" })).toHaveLength(0);
  });
});
