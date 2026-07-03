import { useRef, useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Package } from "lucide-react";
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
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
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

  const [, navigate] = useLocation();
  const { items, isLoading, isError, refetch, stats, availabilityPct, verifiedCount, notVerifiedCount } =
    useEquipmentList({
      search,
      statusFilter,
    });
  const hasActiveFilters = search !== "" || statusFilter !== "all";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        // Bottom: 16px base + 56px so the last row clears the floating chat
        // FAB (48px + 8px gap above the tab bar) — H5.
        padding: "16px 16px calc(72px + env(safe-area-inset-bottom))",
        minHeight: "100%",
      }}
    >
      <EquipmentLargeTitle
        title={t.equipment.title}
        count={stats.total}
        availabilityPct={availabilityPct}
        isLoading={isLoading}
        verifiedCount={verifiedCount}
        notVerifiedCount={notVerifiedCount}
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
        <EmptyState
          icon={Package}
          message={t.equipmentList.empty.message}
          subMessage={
            hasActiveFilters ? t.equipmentList.empty.filteredHint : t.equipmentList.empty.emptyHint
          }
          action={
            hasActiveFilters ? (
              <Button
                variant="outline"
                size="sm"
                className="h-11 text-xs"
                onClick={() => navigate("/equipment", { replace: true })}
              >
                {t.equipmentList.empty.clearFilters}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <EquipmentStatStrip
            total={stats.total}
            attention={stats.attention}
            inUse={stats.inUse}
            showUptime={false}
          />
          <EquipmentTriageList items={items} />
        </>
      )}
    </div>
  );
}
