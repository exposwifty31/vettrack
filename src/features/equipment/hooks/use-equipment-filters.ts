import { useSearch, useLocation } from "wouter";
import { useMemo } from "react";

export function useEquipmentFilters() {
  const searchStr = useSearch();
  const [location, navigate] = useLocation();

  const params = useMemo(() => new URLSearchParams(searchStr), [searchStr]);
  const search = params.get("q") ?? "";
  const statusFilter = params.get("status") ?? "all";

  function setSearch(value: string) {
    const next = new URLSearchParams(searchStr);
    if (value) {
      next.set("q", value);
    } else {
      next.delete("q");
    }
    const qs = next.toString();
    navigate(qs ? `${location}?${qs}` : location, { replace: true });
  }

  function setStatusFilter(value: string) {
    const next = new URLSearchParams(searchStr);
    if (value && value !== "all") {
      next.set("status", value);
    } else {
      next.delete("status");
    }
    const qs = next.toString();
    navigate(qs ? `${location}?${qs}` : location, { replace: true });
  }

  return { search, statusFilter, setSearch, setStatusFilter };
}
