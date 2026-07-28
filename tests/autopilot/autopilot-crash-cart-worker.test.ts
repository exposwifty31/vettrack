import { describe, it, expect, vi } from "vitest";
import { runCrashCartDriftScan } from "../../server/workers/autopilotCrashCartDriftWorker.js";
import { InMemoryCrashCartDriftReader } from "../../server/lib/autopilot/crash-cart-drift-reader.port.js";
import { InMemoryActionProposalWriter } from "../../server/lib/autopilot/action-proposal-writer.port.js";

vi.mock("../../server/lib/audit.js", () => ({ logAudit: vi.fn() }));
vi.mock("../../server/lib/metrics.js", () => ({ incrementMetric: vi.fn() }));

const CLINIC_A = "clinic-a";
const NOW = new Date("2026-07-22T09:00:00.000Z");

describe("autopilotCrashCartDriftWorker.runCrashCartDriftScan", () => {
  it("stages exactly one crash_cart_drift proposal for a clinic-day with a missing-item drift", async () => {
    const reader = new InMemoryCrashCartDriftReader({
      checks: [
        {
          id: "check-1",
          clinicId: CLINIC_A,
          performedAt: NOW,
          allPassed: false,
          itemsChecked: [{ key: "epinephrine", label: "Epinephrine", checked: false }],
        },
      ],
      items: [{ id: "item-epi", clinicId: CLINIC_A, key: "epinephrine", label: "Epinephrine", active: true }],
    });
    const writer = new InMemoryActionProposalWriter();

    const result = await runCrashCartDriftScan(
      { reader, writer, findCandidateClinics: async () => [CLINIC_A] },
      NOW,
    );

    expect(result).toEqual({ scanned: 1, staged: 1 });
    const staged = await writer.findStaged(CLINIC_A, { kind: "crash_cart_drift" });
    expect(staged).toHaveLength(1);
    expect(staged[0]?.sourceSessionId).toBe("2026-07-22");
  });

  it("does not double-stage on a second scan of the same clinic-day and does not emit a duplicate audit/metric", async () => {
    const { logAudit } = await import("../../server/lib/audit.js");
    const { incrementMetric } = await import("../../server/lib/metrics.js");
    vi.mocked(logAudit).mockClear();
    vi.mocked(incrementMetric).mockClear();

    const reader = new InMemoryCrashCartDriftReader({
      checks: [
        {
          id: "check-1",
          clinicId: CLINIC_A,
          performedAt: NOW,
          allPassed: false,
          itemsChecked: [{ key: "epinephrine", label: "Epinephrine", checked: false }],
        },
      ],
      items: [{ id: "item-epi", clinicId: CLINIC_A, key: "epinephrine", label: "Epinephrine", active: true }],
    });
    const writer = new InMemoryActionProposalWriter();
    const deps = { reader, writer, findCandidateClinics: async () => [CLINIC_A] };

    await runCrashCartDriftScan(deps, NOW);
    const second = await runCrashCartDriftScan(deps, NOW);

    expect(second.staged).toBe(0);
    const staged = await writer.findStaged(CLINIC_A, { kind: "crash_cart_drift" });
    expect(staged).toHaveLength(1);
    expect(
      vi.mocked(incrementMetric).mock.calls.filter(([name]) => name === "autopilot_proposal_staged_total"),
    ).toHaveLength(1);
    expect(
      vi.mocked(logAudit).mock.calls.filter(([entry]) => entry.actionType === "action_proposal_staged"),
    ).toHaveLength(1);
  });

  it("stages a staleness proposal when no drift is missing-items but the last check is overdue", async () => {
    const reader = new InMemoryCrashCartDriftReader({
      checks: [
        {
          id: "check-2",
          clinicId: CLINIC_A,
          performedAt: new Date("2026-07-20T00:00:00.000Z"),
          allPassed: true,
          itemsChecked: [],
        },
      ],
      items: [],
    });
    const writer = new InMemoryActionProposalWriter();

    const result = await runCrashCartDriftScan(
      { reader, writer, findCandidateClinics: async () => [CLINIC_A] },
      NOW,
    );

    expect(result).toEqual({ scanned: 1, staged: 1 });
    const staged = await writer.findStaged(CLINIC_A, { kind: "crash_cart_drift" });
    expect(staged).toHaveLength(1);
  });

  it("stages nothing when the cart is clean (recent, all-passed check)", async () => {
    const reader = new InMemoryCrashCartDriftReader({
      checks: [{ id: "check-3", clinicId: CLINIC_A, performedAt: NOW, allPassed: true, itemsChecked: [] }],
      items: [],
    });
    const writer = new InMemoryActionProposalWriter();

    const result = await runCrashCartDriftScan(
      { reader, writer, findCandidateClinics: async () => [CLINIC_A] },
      NOW,
    );

    expect(result).toEqual({ scanned: 1, staged: 0 });
    const staged = await writer.findStaged(CLINIC_A, { kind: "crash_cart_drift" });
    expect(staged).toHaveLength(0);
  });

  it("stages nothing for a clinic with no candidate crash-cart items at all", async () => {
    const reader = new InMemoryCrashCartDriftReader({ checks: [], items: [] });
    const writer = new InMemoryActionProposalWriter();

    const result = await runCrashCartDriftScan(
      { reader, writer, findCandidateClinics: async () => [] },
      NOW,
    );

    expect(result).toEqual({ scanned: 0, staged: 0 });
  });
});
