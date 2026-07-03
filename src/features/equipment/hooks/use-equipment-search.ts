import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import type { Equipment } from "@/types";

/** Max typeahead rows — keep the dropdown scannable, not a second list view. */
export const MAX_SEARCH_RESULTS = 8;

/**
 * Case-insensitive match across the same fields the equipment list search uses
 * (see equipment-list.tsx) so the topbar typeahead and the full list agree on
 * what "matches". `q` is expected pre-lowercased and trimmed.
 */
export function matchesEquipmentQuery(eq: Equipment, q: string): boolean {
  if (!q) return false;
  return (
    eq.name.toLowerCase().includes(q) ||
    (eq.nameHe?.toLowerCase().includes(q) ?? false) ||
    (eq.serialNumber?.toLowerCase().includes(q) ?? false) ||
    (eq.model?.toLowerCase().includes(q) ?? false) ||
    (eq.location?.toLowerCase().includes(q) ?? false)
  );
}

/**
 * Typeahead search over the cached equipment list. Reuses the `["/api/equipment"]`
 * query the shell already loads (NativeHeader alerts), so it adds no fetch and the
 * filter is instant — no debounce needed for an in-memory list of this size.
 */
export function useEquipmentSearch(query: string): { results: Equipment[]; isLoading: boolean } {
  const { userId } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["/api/equipment"],
    queryFn: api.equipment.list,
    enabled: !!userId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !data) return [];
    return data.filter((eq) => matchesEquipmentQuery(eq, q)).slice(0, MAX_SEARCH_RESULTS);
  }, [query, data]);

  return { results, isLoading };
}
