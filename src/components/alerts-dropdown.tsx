import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, Bell, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";
import { useDirection } from "@/hooks/useDirection";
import type { Alert } from "@/types";

interface AlertsDropdownProps {
  alerts: Alert[];
  alertCount: number;
  badgeAnimating: boolean;
}

export function AlertsDropdown({ alerts, alertCount, badgeAnimating }: AlertsDropdownProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const direction = useDirection();
  const Chevron = direction === "rtl" ? ChevronLeft : ChevronRight;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const preview = alerts.slice(0, 6);

  return (
    <div className="relative" ref={panelRef}>
      <Button
        variant="ghost"
        size="icon"
        className="relative min-h-[44px] min-w-[44px] text-[var(--brand-green-bright)] hover:text-[var(--on-ink)] hover:bg-[var(--ink-sheen)]"
        aria-label={t.layout.alertsDropdown.toggleAria(alertCount)}
        aria-expanded={open}
        data-testid="alert-bell"
        onClick={() => setOpen((o) => !o)}
      >
        <Bell className="w-5 h-5" aria-hidden />
        {alertCount > 0 && (
          <>
            <span
              className="absolute -top-0.5 -end-0.5 w-3.5 h-3.5 rounded-full bg-[var(--status-issue-fg)] pointer-events-none"
              style={{ animation: "alertPing 2s ease-out infinite" }}
              aria-hidden
            />
            <span
              key={alertCount}
              className={cn(
                "absolute -top-0.5 -end-0.5 w-3.5 h-3.5 bg-[var(--status-issue-fg)] text-[var(--on-ink)] text-[9px]",
                "rounded-full flex items-center justify-center font-bold z-10",
                badgeAnimating &&
                  "[animation:badgePop_420ms_cubic-bezier(0.68,-0.55,0.265,1.55)_forwards]",
              )}
              aria-hidden
            >
              {alertCount > 9 ? "9+" : alertCount}
            </span>
          </>
        )}
      </Button>

      {open && (
        <div
          className={cn(
            "absolute top-full mt-2 z-[60] w-[min(20rem,calc(100vw-2rem))]",
            "end-0 rounded-2xl border border-border bg-card shadow-xl overflow-hidden",
            "origin-top-end animate-in fade-in-0 zoom-in-95 duration-150",
          )}
          data-testid="alerts-dropdown-panel"
          role="menu"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
            <p className="text-sm font-bold text-foreground">{t.layout.nav.alerts}</p>
            {alertCount > 0 && (
              <span className="text-xs font-semibold text-muted-foreground tabular-nums">
                {t.layout.alertsDropdown.activeCount(alertCount)}
              </span>
            )}
          </div>

          <div className="max-h-[min(50dvh,320px)] overflow-y-auto">
            {preview.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                {t.layout.alertsDropdown.empty}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {preview.map((alert) => (
                  <li key={`${alert.equipmentId}-${alert.type}`}>
                    <Link
                      href={`/equipment/${alert.equipmentId}`}
                      className="flex items-start gap-2.5 px-3 py-2.5 hover:bg-muted/60 transition-colors"
                      onClick={() => setOpen(false)}
                      role="menuitem"
                    >
                      <AlertTriangle
                        className={cn(
                          "w-4 h-4 shrink-0 mt-0.5",
                          alert.severity === "critical" ? "text-red-500" : "text-amber-500",
                        )}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1 text-start">
                        <p className="text-sm font-medium text-foreground truncate">{alert.equipmentName}</p>
                        <p className="text-xs text-muted-foreground line-clamp-2">{alert.detail}</p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-border p-2">
            <Link
              href="/alerts"
              className="flex h-10 w-full items-center justify-center gap-1 rounded-xl bg-muted/80 text-sm font-semibold text-foreground hover:bg-muted"
              onClick={() => setOpen(false)}
              data-testid="alerts-dropdown-see-all"
            >
              {t.layout.alertsDropdown.seeAll}
              <Chevron className="w-4 h-4" aria-hidden />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
