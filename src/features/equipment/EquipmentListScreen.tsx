import { useRef, useState, useEffect } from "react";
import { useEquipmentList } from "./hooks/use-equipment-list";
import { useEquipmentFilters } from "./hooks/use-equipment-filters";
import { EquipmentLargeTitle } from "./EquipmentLargeTitle";
import { EquipmentSearchBar } from "./EquipmentSearchBar";
import { EquipmentFilterChips } from "./EquipmentFilterChips";
import {
  EquipmentStatStrip,
  EquipmentTriageList,
} from "@/components/equipment/EquipmentTriageList";
import { LoadingSection } from "@/components/ui/loading-section";
import { ErrorCard } from "@/components/ui/error-card";
import { t } from "@/lib/i18n";

const DEBOUNCE_MS = 300;

export function EquipmentListScreen() {
  const { search, statusFilter, setSearch, setStatusFilter } = useEquipmentFilters();
  const [inputValue, setInputValue] = useState(search);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setInputValue(search);
  }, [search]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function handleSearchChange(value: string) {
    setInputValue(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      setSearch(value);
    }, DEBOUNCE_MS);
  }

  const { items, isLoading, isError, refetch, stats, availabilityPct } = useEquipmentList({
    search,
    statusFilter,
  });

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: "16px 16px calc(16px + env(safe-area-inset-bottom))",
        minHeight: "100%",
      }}
    >
      <EquipmentLargeTitle
        title={t.equipment.title}
        count={stats.total}
        availabilityPct={availabilityPct}
      />

      <EquipmentSearchBar
        value={inputValue}
        onChange={handleSearchChange}
        placeholder={t.equipmentList.search.placeholder}
      />

      <EquipmentFilterChips value={statusFilter} onChange={setStatusFilter} />

      {isLoading ? (
        <LoadingSection rows={5} />
      ) : isError ? (
        <ErrorCard message={t.errorCard.defaultMessage} onRetry={refetch} />
      ) : items.length === 0 ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: 1,
            padding: "32px 0",
            color: "var(--muted-foreground)",
            fontSize: "var(--text-sm)",
          }}
        >
          {t.equipmentList.empty.message}
        </div>
      ) : (
        <>
          <EquipmentStatStrip
            total={stats.total}
            attention={stats.attention}
            inUse={stats.inUse}
          />
          <EquipmentTriageList items={items} />
        </>
      )}
    </div>
  );
}
