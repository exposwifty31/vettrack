/**
 * @vitest-environment happy-dom
 *
 * useEquipmentList.refetch must invalidate the PREFIX key ["/api/equipment"]
 * (Bugbot dc9c4e67): the paginated rows live under ["/api/equipment",
 * "paginated"] while the verified-split readout reads ["/api/equipment"] —
 * invalidating only the paginated key left the header counts stale after a
 * manual retry. Prefix invalidation covers both.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEquipmentList } from "@/features/equipment/hooks/use-equipment-list";

vi.mock("@/lib/auth-store", () => ({ getCurrentUserId: () => "u-1" }));
vi.mock("@/lib/api", () => ({ api: { equipment: { list: vi.fn(async () => []) } } }));
vi.mock("@/hooks/use-paginated-equipment", () => ({
  usePaginatedEquipment: () => ({ data: { items: [], total: 0 }, isLoading: false, isError: false }),
}));

describe("useEquipmentList refetch", () => {
  it("invalidates the /api/equipment prefix so rows AND verified split refresh", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(
      () => useEquipmentList({ search: "", statusFilter: "all" }),
      { wrapper },
    );
    result.current.refetch();

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["/api/equipment"] });
  });
});
