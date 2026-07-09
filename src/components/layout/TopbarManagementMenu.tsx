// src/components/layout/TopbarManagementMenu.tsx
// Collapses the web-management console links into a single labeled "Management" dropdown
// in the desktop Topbar. Phase 7 grew the management nav to ~11 nodes; rendered inline in
// the Topbar's horizontal overflow strip they scrolled out of view at common desktop widths
// (M2). A labeled dropdown always fits and keeps the links discoverable. Mirrors the
// hand-rolled dropdown pattern in TopbarSettingsMenu (click-outside + Escape, no Radix dep).
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";

interface ManagementNavItem {
  id: string;
  href: string;
  labelKey: string;
}

function navLabel(key: string): string {
  const k = key.startsWith("nav.") ? key.slice(4) : key;
  return (t.nav as Record<string, string>)[k] ?? key;
}

export function TopbarManagementMenu({ items, activeHref }: { items: ManagementNavItem[]; activeHref: string }) {
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (items.length === 0) return null;

  const containsActive = items.some((n) => n.href === activeHref);

  function go(href: string) {
    setOpen(false);
    navigate(href);
  }

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex items-center gap-1.5 text-sm font-medium px-2.5 py-1 rounded-[4px] whitespace-nowrap transition-colors duration-100",
          containsActive ? "bg-indigo-600 text-white font-semibold" : "text-white/60 hover:text-white/85",
        )}
      >
        <LayoutGrid size={15} strokeWidth={2} />
        {t.nav.management}
        <span aria-hidden className={cn("transition-transform duration-150", open && "rotate-180")}>
          ▾
        </span>
      </button>

      {open && (
        <>
          <div aria-hidden onClick={() => setOpen(false)} className="fixed inset-0 z-40" />
          <div
            ref={panelRef}
            tabIndex={-1}
            aria-label={t.nav.management}
            className="absolute z-50 mt-2 w-60 end-0 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] shadow-[0_18px_48px_rgba(0,0,0,0.22)] p-1.5 outline-none max-h-[70vh] overflow-y-auto"
          >
            {items.map((n) => (
              <button
                key={n.id}
                type="button"
                aria-current={activeHref === n.href ? "page" : undefined}
                onClick={() => go(n.href)}
                className={cn(
                  "flex items-center w-full min-h-11 px-2.5 py-2 rounded-[10px] text-sm text-start transition-colors",
                  activeHref === n.href
                    ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-semibold"
                    : "bg-transparent hover:bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]",
                )}
              >
                {navLabel(n.labelKey)}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
