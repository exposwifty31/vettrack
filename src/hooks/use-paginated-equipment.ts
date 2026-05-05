import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { EquipmentPage } from "@/lib/api";

export interface UsePaginatedEquipmentOptions {
  page?: number;
  pageSize?: number;
  enabled?: boolean;
  q?: string;
  status?: string;
  folder?: string;
  location?: string;
}

export function getPaginatedEquipmentQueryOptions(
  opts: UsePaginatedEquipmentOptions = {}
) {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 100;
  const normalizedFilters = {
    q: opts.q?.trim() || undefined,
    status: opts.status && opts.status !== "all" ? opts.status : undefined,
    folder: opts.folder && opts.folder !== "all" ? opts.folder : undefined,
    location: opts.location && opts.location !== "all" ? opts.location : undefined,
  };

  const queryKey = [
    "/api/equipment",
    "paginated",
    page,
    pageSize,
    normalizedFilters.q,
    normalizedFilters.status,
    normalizedFilters.folder,
    normalizedFilters.location,
  ] as const;

  const queryFn = () =>
    api.equipment.listPaginated(page, pageSize, normalizedFilters);

  return { queryKey, queryFn };
}

export function usePaginatedEquipment(
  opts: UsePaginatedEquipmentOptions = {}
) {
  const { queryKey, queryFn } = getPaginatedEquipmentQueryOptions(opts);

  return useQuery<EquipmentPage>({
    queryKey,
    queryFn,
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
    /** Avoid churn / flicker from treating fresh list data as immediately stale on large pages. */
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
    // Override global false: refetch on mount if data is stale so invalidateQueries
    // from create/update mutations is picked up when the list remounts.
    refetchOnMount: true,
  });
}
