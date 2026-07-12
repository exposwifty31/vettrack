import { useEffect, useId, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { t } from "@/lib/i18n";
import { Bdi } from "@/components/ui/bdi";
import { getEquipmentDisplayName } from "@/lib/equipment-display";
import { matchesEquipmentQuery } from "@/features/equipment/hooks/use-equipment-search";
import type { Equipment } from "@/types";

/** Keep the dropdown scannable, not a second list view (mirrors EquipmentSearchBox). */
const MAX_VISIBLE_RESULTS = 20;

type Props = {
  id: string;
  /** The clinic's equipment records — pass the shared `["/api/equipment"]` query result, don't fetch again here. */
  equipment: Equipment[];
  isLoading?: boolean;
  /** Selected `vt_equipment.id`, or "" when nothing is picked. */
  value: string;
  onChange: (equipmentId: string) => void;
  required?: boolean;
};

/** Secondary line for a result row: whichever identifying fields exist. */
function subtitle(eq: Equipment): string {
  return [eq.serialNumber, eq.model, eq.location].filter(Boolean).join(" · ");
}

/**
 * T23: searchable equipment-record picker for the task "device" field.
 * Replaces the old free-text input — the value this reports via `onChange`
 * is always a real `vt_equipment.id`, never a typed string. Reuses the
 * shared equipment fetch (passed in via `equipment`/`isLoading`) and the
 * same match predicate the topbar equipment search uses, so there's no
 * parallel fetch and no divergent "what counts as a match" logic.
 */
export function EquipmentDeviceField({ id, equipment, isLoading, value, onChange, required }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selected = useMemo(() => equipment.find((eq) => eq.id === value) ?? null, [equipment, value]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...equipment].sort((a, b) =>
      getEquipmentDisplayName(a).localeCompare(getEquipmentDisplayName(b)),
    );
    const matched = q ? sorted.filter((eq) => matchesEquipmentQuery(eq, q)) : sorted;
    return matched.slice(0, MAX_VISIBLE_RESULTS);
  }, [equipment, query]);

  /** Stable per-option id, keyed to the equipment id (not list position) so it
   * stays correct across re-sorts/re-filters — target of `aria-activedescendant`. */
  function optionId(equipmentId: string): string {
    return `${listId}-option-${equipmentId}`;
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
        setActive(-1);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Keyboard focus never leaves the input (options aren't independently
  // tabbable — see the single-option-model note below), so a focusout whose
  // relatedTarget lands outside the wrapper means focus moved elsewhere
  // (e.g. Tab to the next field) and the popup must close.
  function onWrapperBlur(event: FocusEvent<HTMLDivElement>) {
    if (wrapperRef.current && !wrapperRef.current.contains(event.relatedTarget as Node | null)) {
      setOpen(false);
      setActive(-1);
    }
  }

  function select(eq: Equipment) {
    onChange(eq.id);
    setQuery("");
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActive((i) => (i + 1) % Math.max(results.length, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (open) setActive((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && active >= 0 && active < results.length) select(results[active]);
    } else if (e.key === "Escape") {
      if (open) {
        setOpen(false);
        setActive(-1);
      }
    }
  }

  const displayValue = open ? query : selected ? getEquipmentDisplayName(selected) : "";
  const activeOptionId = open && active >= 0 && active < results.length ? optionId(results[active].id) : undefined;

  return (
    <div ref={wrapperRef} className="relative" onBlur={onWrapperBlur}>
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeOptionId}
        aria-required={required}
        required={required}
        dir="auto"
        autoComplete="off"
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        value={displayValue}
        placeholder={t.appointmentsPage.placeholderDevice}
        onFocus={() => {
          setQuery("");
          setOpen(true);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(-1);
          // Typing invalidates the previous pick — the stored value must
          // always be a real equipment id, never the in-progress search text.
          if (value) onChange("");
        }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute top-full z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {isLoading ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">{t.common.loading}</li>
          ) : results.length === 0 ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">{t.equipmentList.empty.message}</li>
          ) : (
            results.map((eq, i) => {
              const sub = subtitle(eq);
              // Single option-interaction model: the <li role="option"> itself is
              // the clickable/hoverable unit (not a nested tabbable <button>), so
              // focus always stays on the input and `aria-activedescendant` above
              // is the only way the active option is exposed to a11y tools.
              return (
                <li
                  key={eq.id}
                  id={optionId(eq.id)}
                  role="option"
                  aria-selected={i === active}
                  // Keep focus on the input so onBlur/outside-click doesn't
                  // close the list before the click registers.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => select(eq)}
                  className={`flex w-full cursor-pointer flex-col items-start gap-0.5 rounded px-3 py-2 text-start transition-colors ${
                    i === active ? "bg-accent" : "hover:bg-accent/60"
                  }`}
                >
                  <Bdi dir="auto" className="w-full truncate text-sm font-medium text-foreground">
                    {getEquipmentDisplayName(eq)}
                  </Bdi>
                  {sub && (
                    <Bdi dir="auto" className="w-full truncate text-xs text-muted-foreground">
                      {sub}
                    </Bdi>
                  )}
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
