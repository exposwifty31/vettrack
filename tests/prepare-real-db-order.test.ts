/**
 * prepare-real-db — deletion-order unit tests.
 *
 * The purge script discovers clinic child tables and delete-blocking FK edges
 * from pg_constraint at runtime; orderTablesForDeletion must emit children
 * before the tables they reference so RESTRICT FKs never fire mid-purge.
 */
import { describe, expect, it } from "vitest";
import { orderTablesForDeletion, type FkEdge } from "../scripts/wetcheck/prepare-real-db.js";

function assertChildBeforeParent(ordered: string[], edges: FkEdge[]): void {
  for (const e of edges) {
    if (e.child === e.parent) continue;
    const ci = ordered.indexOf(e.child);
    const pi = ordered.indexOf(e.parent);
    if (ci === -1 || pi === -1) continue;
    expect(ci, `${e.child} must be deleted before ${e.parent}`).toBeLessThan(pi);
  }
}

describe("orderTablesForDeletion", () => {
  it("orders a reference chain children-first", () => {
    const tables = ["vt_purchase_orders", "vt_po_lines", "vt_items"];
    const edges: FkEdge[] = [
      { child: "vt_po_lines", parent: "vt_purchase_orders" },
      { child: "vt_po_lines", parent: "vt_items" },
    ];
    const ordered = orderTablesForDeletion(tables, edges);
    expect(ordered).toHaveLength(3);
    assertChildBeforeParent(ordered, edges);
    expect(ordered[0]).toBe("vt_po_lines");
  });

  it("handles a diamond dependency", () => {
    const tables = ["a", "b", "c", "d"];
    const edges: FkEdge[] = [
      { child: "a", parent: "b" },
      { child: "a", parent: "c" },
      { child: "b", parent: "d" },
      { child: "c", parent: "d" },
    ];
    const ordered = orderTablesForDeletion(tables, edges);
    expect(new Set(ordered)).toEqual(new Set(tables));
    assertChildBeforeParent(ordered, edges);
  });

  it("emits every table exactly once even with cycles", () => {
    const tables = ["x", "y", "z"];
    const edges: FkEdge[] = [
      { child: "x", parent: "y" },
      { child: "y", parent: "x" },
    ];
    const ordered = orderTablesForDeletion(tables, edges);
    expect([...ordered].sort()).toEqual(["x", "y", "z"]);
  });

  it("ignores self-references and edges outside the table set", () => {
    const tables = ["vt_folders", "vt_equipment"];
    const edges: FkEdge[] = [
      { child: "vt_folders", parent: "vt_folders" },
      { child: "vt_equipment", parent: "vt_folders" },
      { child: "vt_outside", parent: "vt_folders" },
    ];
    const ordered = orderTablesForDeletion(tables, edges);
    expect(ordered).toEqual(["vt_equipment", "vt_folders"]);
  });

  it("is deterministic for unconstrained tables (alphabetical)", () => {
    const ordered = orderTablesForDeletion(["c", "a", "b"], []);
    expect(ordered).toEqual(["a", "b", "c"]);
  });
});
