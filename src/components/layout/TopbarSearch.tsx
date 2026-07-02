// src/components/layout/TopbarSearch.tsx
// Desktop topbar equipment-search entry point. Owns no search state — it navigates
// to /equipment?q=<query>, which the equipment list already reads via useSearch()
// (see features/equipment/hooks/use-equipment-filters.ts). URL-as-state, not a store.
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Search } from "lucide-react";
import { t } from "@/lib/i18n";

export function TopbarSearch() {
  const [, navigate] = useLocation();
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // "/" focuses the search from anywhere, unless the user is already typing in a
  // field or editing content (so "/" stays literal inside inputs/textareas).
  useEffect(() => {
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
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = value.trim();
    navigate(q ? `/equipment?q=${encodeURIComponent(q)}` : "/equipment");
    inputRef.current?.blur();
  }

  return (
    <form
      onSubmit={submit}
      role="search"
      className="hidden lg:flex items-center gap-2 min-w-[240px] h-7 ps-2.5 pe-1.5 rounded-[10px] bg-white/10 border border-white/15 focus-within:bg-white/15 focus-within:border-white/25 transition-colors"
    >
      <Search size={15} strokeWidth={2} className="text-white/55 shrink-0" aria-hidden />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t.equipmentList.search.placeholder}
        aria-label={t.equipmentList.search.placeholder}
        className="flex-1 min-w-0 bg-transparent border-0 outline-none text-sm text-white placeholder:text-white/45 [appearance:none] [&::-webkit-search-cancel-button]:hidden"
      />
      <kbd
        aria-hidden
        dir="ltr"
        className="shrink-0 vt-text-2xs font-medium text-white/50 bg-white/10 rounded-[5px] px-1.5 py-px leading-none"
      >
        /
      </kbd>
    </form>
  );
}
