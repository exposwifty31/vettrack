import { describe, it, expect, vi } from "vitest";
import { buildRestockPoApproveSideEffect } from "../../server/lib/autopilot/restock-po-approve-side-effect.js";
import type { ActionProposalRow } from "../../server/schema/ops.js";

const CLINIC_A = "clinic-a";
const APPROVER_USER_ID = "user-approver";

function buildStagedRow(overrides: Partial<ActionProposalRow> = {}): ActionProposalRow {
  return {
    id: "proposal-1",
    clinicId: CLINIC_A,
    kind: "restock_po_on_burn",
    status: "staged",
    sourceSessionId: "2026-07-22",
    summary: "Restock needed",
    citedFacts: [],
    draftContent: { supplierName: "Autopilot", lines: [{ itemId: "item-1", quantitySuggested: 5 }] },
    sourceRef: {},
    citationValidation: { valid: true, checks: [] },
    editedContent: null,
    rejectionReason: null,
    decidedByUserId: null,
    decidedAt: null,
    createdAt: new Date("2026-07-22T06:00:00.000Z"),
    updatedAt: new Date("2026-07-22T06:00:00.000Z"),
    ...overrides,
  } as ActionProposalRow;
}

function buildFakeTx() {
  const insertedValues: { table: unknown; values: Record<string, unknown> }[] = [];
  const tx = {
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        insertedValues.push({ table, values });
        return Promise.resolve();
      },
    }),
  };
  return { tx: tx as never, insertedValues };
}

describe("buildRestockPoApproveSideEffect", () => {
  it("returns undefined for a non-restock kind — no side effect dispatched", () => {
    const staged = buildStagedRow({ kind: "coordinator_reassign_off_roster" });
    expect(buildRestockPoApproveSideEffect(staged, APPROVER_USER_ID)).toBeUndefined();
  });

  it("inserts one purchaseOrders row (status draft, createdBy = the approving user, real supplierName) and one poLines row per draft line", async () => {
    const staged = buildStagedRow({
      draftContent: {
        supplierName: "Autopilot",
        lines: [
          { itemId: "item-1", quantitySuggested: 12 },
          { itemId: "item-2", quantitySuggested: 3 },
        ],
      },
    });
    const sideEffect = buildRestockPoApproveSideEffect(staged, APPROVER_USER_ID);
    expect(sideEffect).toBeDefined();

    const { tx, insertedValues } = buildFakeTx();
    await sideEffect!(tx);

    const poInserts = insertedValues.filter((v) => "supplierName" in v.values);
    const lineInserts = insertedValues.filter((v) => "quantityOrdered" in v.values);

    expect(poInserts).toHaveLength(1);
    expect(poInserts[0]!.values).toMatchObject({
      clinicId: CLINIC_A,
      supplierName: "Autopilot",
      status: "draft",
      createdBy: APPROVER_USER_ID,
    });

    expect(lineInserts).toHaveLength(2);
    expect(lineInserts[0]!.values).toMatchObject({ clinicId: CLINIC_A, itemId: "item-1", quantityOrdered: 12 });
    expect(lineInserts[1]!.values).toMatchObject({ clinicId: CLINIC_A, itemId: "item-2", quantityOrdered: 3 });

    // every line references the SAME purchaseOrderId as the PO just inserted
    const orderId = (poInserts[0]!.values as { id: string }).id;
    for (const line of lineInserts) {
      expect((line.values as { purchaseOrderId: string }).purchaseOrderId).toBe(orderId);
    }
  });

  it("uses the approving actor's real userId as createdBy — never a system id", async () => {
    const staged = buildStagedRow();
    const sideEffect = buildRestockPoApproveSideEffect(staged, "user-real-approver-42")!;
    const { tx, insertedValues } = buildFakeTx();
    await sideEffect(tx);
    const po = insertedValues.find((v) => "supplierName" in v.values)!;
    expect((po.values as { createdBy: string }).createdBy).toBe("user-real-approver-42");
    expect((po.values as { createdBy: string }).createdBy).not.toMatch(/^system:/);
  });

  it("throws when the staged row's draftContent does not match the expected RestockPoDraftContent shape", () => {
    const staged = buildStagedRow({ draftContent: { not: "a valid draft" } });
    expect(() => buildRestockPoApproveSideEffect(staged, APPROVER_USER_ID)).toThrow();
  });
});
