import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Stage 5 — Inventory item detail (new screen) LOCK.
 *
 * inventory-item-detail.tsx is a net-new screen backed by a real read endpoint
 * (GET /api/inventory-items/:id/detail) that aggregates on-hand distribution
 * (vt_container_items) + 7-day usage (vt_dispense_events). It must consume the
 * Stage-1 semantic tokens, carry no hardcoded palette or copy, and be wired
 * end-to-end (route + api client + server handler).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

const page = read("src/pages/inventory-item-detail.tsx");
const apiSrc = read("src/lib/api.ts");
const routesSrc = read("src/app/routes.tsx");
const serverSrc = read("server/routes/inventory-items.ts");
const i18nSrc = read("src/lib/i18n.ts");

describe("Stage 5 item detail — consumes semantic tokens", () => {
  it("status indicators read the --status-* HSL tokens", () => {
    expect(page.includes("hsl(var(--status-ok))")).toBe(true);
    expect(page.includes("hsl(var(--status-issue))")).toBe(true);
  });
  it("renders through i18n, no hardcoded strings", () => {
    expect(page.includes("t.inventoryItemDetailPage")).toBe(true);
    expect(i18nSrc.includes("inventoryItemDetailPage")).toBe(true);
  });
});

describe("Stage 5 item detail — no hardcoded palette", () => {
  const banned = [
    "emerald-", "amber-", "red-500", "red-100", "green-500", "green-600", "zinc-", "indigo-",
  ];
  for (const token of banned) {
    it(`does not use the "${token}" palette`, () => {
      expect(page.includes(token)).toBe(false);
    });
  }
});

describe("Stage 5 item detail — wired end to end", () => {
  it("has a lazy route at /inventory-items/:id", () => {
    expect(routesSrc.includes("InventoryItemDetailPage")).toBe(true);
    expect(routesSrc.includes('path="/inventory-items/:id"')).toBe(true);
  });
  it("exposes api.inventoryItems.detail", () => {
    expect(/detail:\s*\(id: string\)\s*=>/.test(apiSrc)).toBe(true);
    expect(apiSrc.includes("/detail")).toBe(true);
  });
  it("backs onto the real detail endpoint aggregating containers + dispense usage", () => {
    expect(serverSrc.includes('"/:id/detail"')).toBe(true);
    expect(serverSrc.includes("containerItems")).toBe(true);
    expect(serverSrc.includes("vt_dispense_events")).toBe(true);
    expect(serverSrc.includes("clinicId")).toBe(true);
  });
});
