import { useEffect, useId, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Search } from "lucide-react";
import { t } from "@/lib/i18n";
import { useEquipmentSearch } from "@/features/equipment/hooks/use-equipment-search";
import type { Equipment } from "@/types";

type Tone = "bar" | "surface";

type Props = {
  /** "bar" = navy topbar (white text); "surface" = themed background (mobile/iPad). */
  tone?: Tone;
  autoFocus?: boolean;
  /** Wire the global "/" shortcut to focus this field (desktop topbar only). */
  enableSlashShortcut?: boolean;
  /** Called after a navigation happens — e.g. to close the mobile overlay. */
  onNavigate?: () => void;
};

/** Secondary line for a result: whichever identifying fields exist. */
function subtitle(eq: Equipment): string {
  return [eq.serialNumber, eq.model, eq.location].filter(Boolean).join(" · ");
}

const inputToneClass: Record<Tone, string> = {
  bar: "bg-white/10 border-white/15 focus-within:bg-white/15 focus-within:border-white/25",
  surface: "bg-muted border-border focus-within:border-primary/50",
};

const iconToneClass: Record<Tone, string> = {
  bar: "text-white/55",
  surface: "text-muted-foreground",
};

const textToneClass: Record<Tone, string> = {
  bar: "text-white placeholder:text-white/45",
  surface: "text-foreground placeholder:text-muted-foreground",
};

export function EquipmentSearchBox({ tone = "surface", autoFocus, enableSlashShortcut, onNavigate }: Props) {
  const [, navigate] = useLocation();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const { results } = useEquipmentSearch(query);
  const open = query.trim().length > 0 && results.length > 0;

  useEffect(() => {
    if (!enableSlashShortcut) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enableSlashShortcut]);

  function goToEquipment(id: string) {
    setQuery("");
    setActive(-1);
    inputRef.current?.blur();
    navigate(`/equipment/${id}`);
    onNavigate?.();
  }

  function submitFullSearch() {
    const q = query.trim();
    setActive(-1);
    inputRef.current?.blur();
    navigate(q ? `/equipment?q=${encodeURIComponent(q)}` : "/equipment");
    onNavigate?.();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && open) {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp" && open) {
      e.preventDefault();
      setActive((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && active >= 0) goToEquipment(results[active]!.id);
      else submitFullSearch();
    } else if (e.key === "Escape") {
      if (query) {
        setQuery("");
        setActive(-1);
      } else {
        inputRef.current?.blur();
      }
    }
  }

  return (
    <div className="relative w-full">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          submitFullSearch();
        }}
        className={`flex items-center gap-2 h-9 ps-3 pe-2 rounded-[10px] border transition-colors ${inputToneClass[tone]}`}
      >
        <Search size={16} strokeWidth={2} className={`shrink-0 ${iconToneClass[tone]}`} aria-hidden />
        <input
          ref={inputRef}
          type="search"
          autoFocus={autoFocus}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(-1);
          }}
          onKeyDown={onKeyDown}
          placeholder={t.equipmentList.search.placeholder}
          aria-label={t.equipmentList.search.placeholder}
          className={`flex-1 min-w-0 bg-transparent border-0 outline-none text-sm ${textToneClass[tone]} [appearance:none] [&::-webkit-search-cancel-button]:hidden`}
        />
      </form>

      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute top-full mt-1.5 inset-x-0 z-50 max-h-[60vh] overflow-y-auto rounded-xl border border-border bg-popover text-popover-foreground shadow-[0_18px_48px_rgba(0,0,0,0.22)] p-1"
        >
          {results.map((eq, i) => {
            const sub = subtitle(eq);
            return (
              <li key={eq.id} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  // Keep focus on the input so onBlur doesn't close before the click lands.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => goToEquipment(eq.id)}
                  className={`flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-start transition-colors ${
                    i === active ? "bg-accent" : "hover:bg-accent/60"
                  }`}
                >
                  <span className="w-full truncate text-sm font-semibold text-foreground">{eq.name}</span>
                  {sub && <span className="w-full truncate text-xs text-muted-foreground">{sub}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
