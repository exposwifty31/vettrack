// src/components/layout/TopbarSettingsMenu.tsx
// Desktop counterpart to the mobile NativeHeader gear dropdown (src/native/NativeHeader.tsx).
// Kept self-contained rather than shared so the device-verified mobile header stays untouched;
// both consume the same nav.* i18n keys and useSettings hook, so copy/behavior stay in lockstep.
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Settings, Moon, Globe, User } from "lucide-react";
import { ForwardChevron } from "@/components/ui/directional-chevron";
import { useIsDarkActive, useSettings } from "@/hooks/use-settings";
import { t } from "@/lib/i18n";

export function TopbarSettingsMenu() {
  const [, navigate] = useLocation();
  const { settings, update } = useSettings();
  const isDarkNow = useIsDarkActive();
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

  function go(href: string) {
    setOpen(false);
    navigate(href);
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={t.nav.settings}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-center w-7 h-7 rounded-full text-white/70 hover:text-white transition-colors"
      >
        <Settings size={18} strokeWidth={1.8} />
      </button>

      {open && (
        <>
          <div
            aria-hidden
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40"
          />
          <div
            ref={panelRef}
            tabIndex={-1}
            aria-label={t.nav.quickSettings}
            className="absolute z-50 mt-2 w-64 end-0 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] shadow-[0_18px_48px_rgba(0,0,0,0.22)] p-1.5 outline-none"
          >
            <p className="m-0 px-2.5 pt-2 pb-1 vt-text-2xs font-semibold uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
              {t.nav.quickSettings}
            </p>

            {/* Explicit light/dark toggle keyed on the ACTIVE mode — mirrors NativeHeader
                (dark→"system" was lossy: "off" resolved back to dark on a dark OS). */}
            <button type="button" aria-pressed={isDarkNow} onClick={() => update({ appearance: isDarkNow ? "light" : "dark" })} className={rowClass}>
              <Moon size={18} strokeWidth={1.8} />
              <span className="flex-1 text-start text-sm">{t.nav.darkMode}</span>
              <MiniSwitch on={isDarkNow} />
            </button>

            <button type="button" onClick={() => update({ locale: settings.locale === "he" ? "en" : "he" })} className={rowClass}>
              <Globe size={18} strokeWidth={1.8} />
              <span className="flex-1 text-start text-sm">{t.nav.language}</span>
              <span className="text-sm text-[hsl(var(--muted-foreground))]">
                {settings.locale === "he" ? t.nav.langHebrewName : t.nav.langEnglishName}
              </span>
            </button>

            <div className="h-px bg-[hsl(var(--border))] mx-2 my-1.5" />

            <button type="button" onClick={() => go("/my-profile")} className={rowClass}>
              <User size={18} strokeWidth={1.8} />
              <span className="flex-1 text-start text-sm">{t.nav.profile}</span>
              <ForwardChevron size={16} className="opacity-60" />
            </button>

            <button type="button" onClick={() => go("/settings")} className={footerClass}>
              <span>{t.nav.allSettings}</span>
              <ForwardChevron size={16} className="opacity-60" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const rowClass =
  "flex items-center gap-2.5 w-full min-h-12 px-2.5 py-2 rounded-[10px] bg-transparent hover:bg-[hsl(var(--muted))] transition-colors text-[hsl(var(--foreground))]";

const footerClass =
  "flex items-center justify-between gap-2 w-full min-h-12 px-2.5 py-2 rounded-[10px] bg-transparent hover:bg-[hsl(var(--muted))] transition-colors text-sm font-semibold text-[hsl(var(--primary))]";

function MiniSwitch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className="relative w-9 h-[22px] rounded-full shrink-0 transition-colors"
      style={{ background: on ? "hsl(var(--primary))" : "hsl(var(--muted))" }}
    >
      <span
        className="absolute top-0.5 w-[18px] h-[18px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.3)] transition-[inset-inline-start]"
        style={{ insetInlineStart: on ? 16 : 2 }}
      />
    </span>
  );
}
