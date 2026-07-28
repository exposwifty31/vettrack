import { describe, it, expect, vi } from "vitest";
import { runRestockBurnScan } from "../../server/workers/autopilotRestockBurnWorker.js";
import { InMemoryRestockBurnReader } from "../../server/lib/autopilot/restock-burn-reader.port.js";
import { InMemoryActionProposalWriter } from "../../server/lib/autopilot/action-proposal-writer.port.js";

vi.mock("../../server/lib/audit.js", () => ({ logAudit: vi.fn() }));
vi.mock("../../server/lib/metrics.js", () => ({ incrementMetric: vi.fn() }));

const CLINIC_A = "clinic-a";
const NOW = new Date("2026-07-22T12:00:00.000Z");
/** The scanDate/sourceSessionId the worker derives from NOW in the RUNNER's local zone — derived here the same way so the assertion is timezone-independent. */
const EXPECTED_SCAN_DATE = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, "0")}-${String(NOW.getDate()).padStart(2, "0")}`;

describe("autopilotRestockBurnWorker.runRestockBurnScan", () => {
  it("stages exactly one restock_po_on_burn proposal for a clinic-day with a flagged item", async () => {
    const reader = new InMemoryRestockBurnReader({
      items: [{ id: "item-1", clinicId: CLINIC_A, reorderPoint: 10, parLevel: 20, isActive: true }],
      containerRows: [
        { id: "ci-1", clinicId: CLINIC_A, containerId: "container-1", itemId: "item-1", quantity: 8, updatedAt: NOW },
      ],
    });
    const writer = new InMemoryActionProposalWriter();

    const result = await runRestockBurnScan(
      { reader, writer, findCandidateClinics: async () => [CLINIC_A] },
      NOW,
    );

    expect(result).toEqual({ scanned: 1, staged: 1 });
    const staged = await writer.findStaged(CLINIC_A, { kind: "restock_po_on_burn" });
    expect(staged).toHaveLength(1);
    expect(staged[0]?.sourceSessionId).toBe(EXPECTED_SCAN_DATE);
  });

  it("isolates a per-clinic failure: one clinic throwing does not abort the scan of later clinics", async () => {
    const CLINIC_B = "clinic-b";
    const goodReader = new InMemoryRestockBurnReader({
      items: [{ id: "item-1", clinicId: CLINIC_B, reorderPoint: 10, parLevel: 20, isActive: true }],
      containerRows: [
        { id: "ci-1", clinicId: CLINIC_B, containerId: "container-1", itemId: "item-1", quantity: 8, updatedAt: NOW },
      ],
    });
    // Reader that throws for clinic-a but delegates to the good reader for clinic-b.
    const reader = {
      read: async (clinicId: string) => {
        if (clinicId === CLINIC_A) throw new Error("boom: clinic-a read failed");
        return goodReader.read(clinicId);
      },
    };
    const writer = new InMemoryActionProposalWriter();

    const result = await runRestockBurnScan(
      { reader, writer, findCandidateClinics: async () => [CLINIC_A, CLINIC_B] },
      NOW,
    );

    // clinic-a threw and was swallowed; clinic-b was still scanned + staged.
    expect(result).toEqual({ scanned: 2, staged: 1 });
    expect(await writer.findStaged(CLINIC_B, { kind: "restock_po_on_burn" })).toHaveLength(1);
    expect(await writer.findStaged(CLINIC_A, { kind: "restock_po_on_burn" })).toHaveLength(0);
  });

  it("does not double-stage on a second scan of the same clinic-day (idempotent per clinic/kind/scanDate) and does not emit a duplicate audit/metric", async () => {
    const { logAudit } = await import("../../server/lib/audit.js");
    const { incrementMetric } = await import("../../server/lib/metrics.js");
    vi.mocked(logAudit).mockClear();
    vi.mocked(incrementMetric).mockClear();

    const reader = new InMemoryRestockBurnReader({
      items: [{ id: "item-1", clinicId: CLINIC_A, reorderPoint: 10, parLevel: 20, isActive: true }],
      containerRows: [
        { id: "ci-1", clinicId: CLINIC_A, containerId: "container-1", itemId: "item-1", quantity: 8, updatedAt: NOW },
      ],
    });
    const writer = new InMemoryActionProposalWriter();
    const deps = { reader, writer, findCandidateClinics: async () => [CLINIC_A] };

    await runRestockBurnScan(deps, NOW);
    const second = await runRestockBurnScan(deps, NOW);

    expect(second.staged).toBe(0);
    const staged = await writer.findStaged(CLINIC_A, { kind: "restock_po_on_burn" });
    expect(staged).toHaveLength(1);
    expect(
      vi.mocked(incrementMetric).mock.calls.filter(([name]) => name === "autopilot_proposal_staged_total"),
    ).toHaveLength(1);
    expect(
      vi.mocked(logAudit).mock.calls.filter(([entry]) => entry.actionType === "action_proposal_staged"),
    ).toHaveLength(1);
  });

  it("stages nothing when no item is flagged", async () => {
    const reader = new InMemoryRestockBurnReader({
      items: [{ id: "item-1", clinicId: CLINIC_A, reorderPoint: 10, parLevel: 20, isActive: true }],
      containerRows: [
        { id: "ci-1", clinicId: CLINIC_A, containerId: "container-1", itemId: "item-1", quantity: 50, updatedAt: NOW },
      ],
    });
    const writer = new InMemoryActionProposalWriter();

    const result = await runRestockBurnScan(
      { reader, writer, findCandidateClinics: async () => [CLINIC_A] },
      NOW,
    );

    expect(result).toEqual({ scanned: 1, staged: 0 });
    const staged = await writer.findStaged(CLINIC_A, { kind: "restock_po_on_burn" });
    expect(staged).toHaveLength(0);
  });

  it("stages nothing for a clinic with no candidate items at all", async () => {
    const reader = new InMemoryRestockBurnReader({ items: [], containerRows: [] });
    const writer = new InMemoryActionProposalWriter();

    const result = await runRestockBurnScan(
      { reader, writer, findCandidateClinics: async () => [CLINIC_A] },
      NOW,
    );

    expect(result).toEqual({ scanned: 1, staged: 0 });
  });
});
