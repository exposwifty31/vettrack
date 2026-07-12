/**
 * @vitest-environment happy-dom
 *
 * T10 (RTL/bidi audit, MEDIUM) — the equipment-list row name cell must
 * bidi-isolate an LTR device name (e.g. "Vetscan VS2") so it truncates on
 * its own logical trailing edge inside the Hebrew (RTL) page context,
 * instead of the surrounding RTL paragraph direction reordering it or
 * clipping the leading edge. Fix is `<Bdi>` (native `<bdi dir="auto">`,
 * `unicode-bidi: isolate`) wrapping the truncated name — never a forced
 * `dir` on the row itself. This locks in the existing production markup at
 * src/pages/equipment-list.tsx (EquipmentItem's name cell); no page render
 * test previously asserted it directly.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Equipment } from "@/types";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ userId: "u1", isAdmin: false }) }));
vi.mock("@/lib/haptics", () => ({ haptics: { tap: vi.fn(), error: vi.fn() } }));

import { EquipmentItem } from "@/pages/equipment-list";

const LTR_NAME = "Vetscan VS2";

function renderItem(equipment: Partial<Equipment>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <EquipmentItem
        equipment={equipment as Equipment}
        selectMode={false}
        selected={false}
        onToggleSelect={() => {}}
        hasActiveShift
        shiftLoading={false}
        shiftError={false}
      />
    </QueryClientProvider>,
  );
}

describe("EquipmentItem (list row) — name cell bidi isolation (T10)", () => {
  afterEach(() => cleanup());

  it("wraps an LTR device name in a <bdi dir='auto'> isolate", () => {
    renderItem({ id: "eq-1", name: LTR_NAME, status: "ok", checkedOutById: null });

    const nameEl = screen.getByText(LTR_NAME);
    const bdi = nameEl.closest("bdi");
    expect(bdi).not.toBeNull();
    expect(bdi?.getAttribute("dir")).toBe("auto");
  });

  it("keeps truncation classes on the isolated name element", () => {
    renderItem({ id: "eq-2", name: LTR_NAME, status: "ok", checkedOutById: null });

    const nameEl = screen.getByText(LTR_NAME);
    expect(nameEl.className).toContain("truncate");
    expect(nameEl.className).toContain("min-w-0");
  });

  it("does not force a direction on the row itself (isolation is scoped to the name run)", () => {
    renderItem({ id: "eq-3", name: LTR_NAME, status: "ok", checkedOutById: null });

    const row = screen.getByTestId("equipment-item-eq-3");
    expect(row.getAttribute("dir")).toBeNull();
  });

  it("still isolates a Hebrew device name the same way (direction is content-derived, not hardcoded LTR)", () => {
    renderItem({ id: "eq-4", name: "משאבת עירוי", status: "ok", checkedOutById: null });

    const nameEl = screen.getByText("משאבת עירוי");
    const bdi = nameEl.closest("bdi");
    expect(bdi).not.toBeNull();
    expect(bdi?.getAttribute("dir")).toBe("auto");
  });
});
