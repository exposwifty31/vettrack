import { describe, it, expect } from "vitest";
import { InMemoryRestockBurnReader } from "../../server/lib/autopilot/restock-burn-reader.port.js";

const CLINIC_A = "clinic-a";
const CLINIC_B = "clinic-b";

describe("RestockBurnReader (reorder-point threshold detection)", () => {
  it("flags an item whose summed on-hand across container rows is at/below reorderPoint, citing both rows", async () => {
    const reader = new InMemoryRestockBurnReader({
      items: [{ id: "item-1", clinicId: CLINIC_A, reorderPoint: 10, parLevel: 20, isActive: true }],
      containerRows: [
        { id: "ci-1", clinicId: CLINIC_A, containerId: "container-1", itemId: "item-1", quantity: 5, updatedAt: new Date("2026-07-22T06:00:00.000Z") },
        { id: "ci-2", clinicId: CLINIC_A, containerId: "container-2", itemId: "item-1", quantity: 3, updatedAt: new Date("2026-07-22T07:00:00.000Z") },
      ],
    });

    const result = await reader.read(CLINIC_A);
    expect(result.items).toHaveLength(1);
    const item = result.items[0]!;
    expect(item.flagged).toBe(true);
    expect(item.onHand).toBe(8);
    expect(item.reorderPoint).toBe(10);
    expect(item.parLevel).toBe(20);
    expect(item.containerRows).toEqual([
      { id: "ci-1", containerId: "container-1", quantity: 5, updatedAt: new Date("2026-07-22T06:00:00.000Z") },
      { id: "ci-2", containerId: "container-2", quantity: 3, updatedAt: new Date("2026-07-22T07:00:00.000Z") },
    ]);
  });

  it("does not flag an item whose summed on-hand is above reorderPoint", async () => {
    const reader = new InMemoryRestockBurnReader({
      items: [{ id: "item-2", clinicId: CLINIC_A, reorderPoint: 10, parLevel: null, isActive: true }],
      containerRows: [
        { id: "ci-3", clinicId: CLINIC_A, containerId: "container-1", itemId: "item-2", quantity: 12, updatedAt: new Date("2026-07-22T06:00:00.000Z") },
      ],
    });

    const result = await reader.read(CLINIC_A);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.flagged).toBe(false);
    expect(result.items[0]!.onHand).toBe(12);
  });

  it("never considers an item with reorderPoint = null (untracked)", async () => {
    const reader = new InMemoryRestockBurnReader({
      items: [{ id: "item-3", clinicId: CLINIC_A, reorderPoint: null, parLevel: 20, isActive: true }],
      containerRows: [
        { id: "ci-4", clinicId: CLINIC_A, containerId: "container-1", itemId: "item-3", quantity: 0, updatedAt: new Date("2026-07-22T06:00:00.000Z") },
      ],
    });

    const result = await reader.read(CLINIC_A);
    expect(result.items).toHaveLength(0);
  });

  it("never considers an inactive item even with a reorderPoint set and low on-hand", async () => {
    const reader = new InMemoryRestockBurnReader({
      items: [{ id: "item-4", clinicId: CLINIC_A, reorderPoint: 10, parLevel: 20, isActive: false }],
      containerRows: [
        { id: "ci-5", clinicId: CLINIC_A, containerId: "container-1", itemId: "item-4", quantity: 0, updatedAt: new Date("2026-07-22T06:00:00.000Z") },
      ],
    });

    const result = await reader.read(CLINIC_A);
    expect(result.items).toHaveLength(0);
  });

  it("cross-tenant negative: clinic A's items and container rows are invisible to a clinic B read", async () => {
    const reader = new InMemoryRestockBurnReader({
      items: [{ id: "item-5", clinicId: CLINIC_A, reorderPoint: 10, parLevel: 20, isActive: true }],
      containerRows: [
        { id: "ci-6", clinicId: CLINIC_A, containerId: "container-1", itemId: "item-5", quantity: 1, updatedAt: new Date("2026-07-22T06:00:00.000Z") },
      ],
    });

    const result = await reader.read(CLINIC_B);
    expect(result.items).toHaveLength(0);
  });

  it("an item with zero container rows sums to onHand=0 and is flagged (with no container-row citations)", async () => {
    const reader = new InMemoryRestockBurnReader({
      items: [{ id: "item-6", clinicId: CLINIC_A, reorderPoint: 5, parLevel: null, isActive: true }],
      containerRows: [],
    });

    const result = await reader.read(CLINIC_A);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.onHand).toBe(0);
    expect(result.items[0]!.flagged).toBe(true);
    expect(result.items[0]!.containerRows).toEqual([]);
  });
});
