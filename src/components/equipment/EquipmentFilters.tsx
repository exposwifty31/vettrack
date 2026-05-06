// src/components/equipment/EquipmentFilters.tsx
import { Search, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface EquipmentFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  onAdd?: () => void;
}

export function EquipmentFilters({ search, onSearchChange, onAdd }: EquipmentFiltersProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      {/* Search */}
      <div className="relative w-[220px]">
        <Search
          size={13}
          strokeWidth={2.2}
          className="absolute start-2.5 top-1/2 -translate-y-1/2 text-ivory-text3 pointer-events-none"
          aria-hidden
        />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="חיפוש ציוד..."
          className={cn(
            "w-full ps-8 pe-3 py-[5px]",
            "rounded-[7px] border border-ivory-border bg-ivory-surface",
            "text-[12.5px] text-ivory-text placeholder:text-ivory-text3",
            "outline-none focus:border-ivory-green focus:ring-2 focus:ring-ivory-green/10",
            "font-sans"
          )}
        />
      </div>

      {/* Add button */}
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          className={cn(
            "flex items-center gap-1.5 px-3 py-[5px]",
            "rounded-[7px] bg-ivory-green text-white",
            "text-[12px] font-medium",
            "hover:bg-ivory-greenMid transition-colors duration-100"
          )}
        >
          <Plus size={13} strokeWidth={2.5} aria-hidden />
          הוסף ציוד
        </button>
      )}
    </div>
  );
}
