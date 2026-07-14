import { useCallback } from "react";
import { useLocation } from "wouter";
import { CalendarClock } from "lucide-react";
import { QrScanner } from "@/components/qr-scanner";
import { useActiveShift } from "@/hooks/use-active-shift";
import { useAuth } from "@/hooks/use-auth";
import { t, formatDateTimeByLocale } from "@/lib/i18n";

export function ScanScreen() {
  const [, navigate] = useLocation();
  const { hasActiveShift, isLoading: shiftLoading, nextShift } = useActiveShift();
  const { isAdmin } = useAuth();

  const handleClose = useCallback(() => {
    navigate("/home");
  }, [navigate]);

  // Off-shift: scanning (and the equipment ownership it captures) is not allowed.
  // The camera must never mount here — roster-derived authority denies it server-side too.
  // Admins are exempt from the shift gate (owner decision, 2026-07) — they can
  // scan without an active roster shift. Non-admin behavior is unchanged.
  const scanBlocked = !shiftLoading && !hasActiveShift && !isAdmin;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "hsl(var(--background))",
      }}
    >
      <div
        style={{
          padding: "calc(env(safe-area-inset-top) + 16px) 16px 12px",
          flexShrink: 0,
        }}
      >
        <h1
          style={{
            fontSize: "var(--text-2xl)",
            fontWeight: 800,
            color: "hsl(var(--foreground))",
            margin: 0,
            lineHeight: 1.2,
          }}
        >
          {t.scan.title}
        </h1>
        <p
          style={{
            fontSize: "var(--text-sm)",
            color: "hsl(var(--muted-foreground))",
            margin: "4px 0 0",
          }}
        >
          {scanBlocked ? t.scan.offShiftSubtitle : t.scan.scanPrompt}
        </p>
      </div>

      <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
        {scanBlocked ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 14,
              padding: "0 32px",
              textAlign: "center",
            }}
          >
            <span
              style={{
                display: "flex",
                width: 64,
                height: 64,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 18,
                background: "var(--status-stale-bg)",
                color: "var(--status-stale-fg)",
              }}
            >
              <CalendarClock size={30} aria-hidden />
            </span>
            <h2
              style={{
                fontSize: "var(--text-lg)",
                fontWeight: 700,
                color: "hsl(var(--foreground))",
                margin: 0,
              }}
            >
              {t.scan.offShiftTitle}
            </h2>
            <p
              style={{
                fontSize: "var(--text-sm)",
                lineHeight: 1.5,
                color: "hsl(var(--muted-foreground))",
                margin: 0,
                maxWidth: "34ch",
              }}
            >
              {t.scan.offShiftBody}
            </p>
            {nextShift && (
              <p style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "hsl(var(--foreground))", margin: 0 }}>
                {t.common.nextShiftLabel}:{" "}
                {formatDateTimeByLocale(nextShift.startsAt, { weekday: "short", hour: "2-digit", minute: "2-digit" })}
              </p>
            )}
            <button
              type="button"
              onClick={() => navigate("/equipment")}
              style={{
                minHeight: 44,
                paddingInline: 20,
                borderRadius: 12,
                border: "1px solid hsl(var(--border))",
                background: "hsl(var(--card))",
                color: "hsl(var(--foreground))",
                fontSize: "var(--text-sm)",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {t.common.browseEquipment}
            </button>
          </div>
        ) : shiftLoading ? null : (
          <QrScanner onClose={handleClose} />
        )}
      </div>
    </div>
  );
}
