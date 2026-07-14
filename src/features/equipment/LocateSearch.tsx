import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { MapPin, Search } from "lucide-react";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { EquipmentLocateResult } from "@/types/locate";

/**
 * Read-only equipment locate search (T-22c · R-EQ-F1). Queries the
 * location + custodian evidence resolver (`api.equipment.locate`, T-22b) and
 * surfaces matches in a bottom-anchored sheet — each row deep-links to the
 * equipment detail (`/equipment/:id`). On the native iPad that same
 * `navigate()` call is already routed into the existing two-pane
 * master-detail by `routes.tsx` (`isNativeTablet ? EquipmentMasterDetail :
 * EquipmentDetailPage`, both matching `/equipment/:id`) — no tablet-specific
 * branch is needed here.
 */

/** Secondary line for a result row: location, custodian (if known), readiness. */
function subtitle(result: EquipmentLocateResult): string {
  const custodian = result.custodian.claims[0]?.value;
  return [result.location.summary, custodian, result.readiness].filter(Boolean).join(" · ");
}

/** Debounce delay before a typed query triggers a network search. */
const SEARCH_DEBOUNCE_MS = 250;

export function LocateSearch() {
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const inputId = useId();
  // The debounced value drives the query key/fetch trigger; the <input> below
  // stays bound to the immediate `query` state so typing feels responsive.
  const trimmed = debouncedQuery.trim();

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  const { data, isFetching } = useQuery({
    queryKey: ["/api/equipment/locate", trimmed],
    queryFn: () => api.equipment.locate(trimmed),
    enabled: open && trimmed.length > 0,
    staleTime: 10_000,
  });

  const results: EquipmentLocateResult[] = trimmed.length > 0 ? (data?.results ?? []) : [];
  const showEmptyPrompt = trimmed.length === 0;
  const showLoading = !showEmptyPrompt && isFetching && results.length === 0;
  const showNoResults = !showEmptyPrompt && !isFetching && results.length === 0;
  const liveMessage = !showEmptyPrompt && !isFetching ? t.locateSearch.resultsCount(results.length) : "";

  function close() {
    setOpen(false);
    setQuery("");
    // Also clear the debounced value — otherwise reopening within
    // SEARCH_DEBOUNCE_MS reuses the prior debouncedQuery and stale results
    // can appear beneath an empty input.
    setDebouncedQuery("");
  }

  function goToEquipment(equipmentId: string) {
    close();
    navigate(`/equipment/${equipmentId}`);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t.locateSearch.openButtonLabel}
        className="fixed bottom-nav-float-2 end-4 z-[60] flex h-12 w-12 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-lg shadow-black/10 transition-transform hover:scale-105 motion-safe:active:scale-95"
      >
        <MapPin size={20} strokeWidth={1.8} aria-hidden />
      </button>

      <Sheet open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <SheetContent side="bottom" className="flex max-h-[85dvh] flex-col rounded-t-2xl">
          <SheetHeader>
            <SheetTitle>{t.locateSearch.title}</SheetTitle>
            <SheetDescription className="sr-only">{t.locateSearch.label}</SheetDescription>
          </SheetHeader>

          <label htmlFor={inputId} className="sr-only">
            {t.locateSearch.label}
          </label>
          <search
            className="mt-3 flex h-10 items-center gap-2 rounded-[10px] border border-border bg-muted px-3"
          >
            <Search size={16} strokeWidth={2} className="shrink-0 text-muted-foreground" aria-hidden />
            <input
              id={inputId}
              type="search"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.locateSearch.placeholder}
              className="min-w-0 flex-1 border-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground [appearance:none] [&::-webkit-search-cancel-button]:hidden"
            />
          </search>

          <output aria-live="polite" className="sr-only">
            {liveMessage}
          </output>

          <div className="mt-3 flex flex-1 flex-col gap-2 overflow-y-auto pb-6">
            {showEmptyPrompt && <p className="text-sm text-muted-foreground">{t.locateSearch.emptyPrompt}</p>}
            {showLoading && <p className="text-sm text-muted-foreground">{t.locateSearch.searching}</p>}
            {showNoResults && <p className="text-sm text-muted-foreground">{t.locateSearch.noResults}</p>}
            {results.map((result) => (
              <button
                key={result.equipmentId}
                type="button"
                onClick={() => goToEquipment(result.equipmentId)}
                className="flex flex-col items-start gap-0.5 rounded-xl border border-border px-3 py-2.5 text-start transition-colors hover:bg-accent/60"
              >
                <span className="w-full truncate text-sm font-semibold text-foreground">{result.name}</span>
                <span className="w-full truncate text-xs text-muted-foreground">{subtitle(result)}</span>
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
