import { useLocation } from "wouter";
import { Settings, Bell } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { computeAlerts } from "@/lib/utils";
import { buildAlertAckSet, countActiveAlerts } from "@/lib/alert-counts";
import { t } from "@/lib/i18n";
import { getInitials } from "@/lib/user-utils";

/** Routes that own their own top chrome — hide the shared header for these. */
const FULLSCREEN_ROUTES = ["/code-blue", "/crash-cart", "/scan", "/handoff"];

export function NativeHeader() {
  const [location, navigate] = useLocation();
  const { userId, name } = useAuth();

  const isFullscreen = FULLSCREEN_ROUTES.some((r) => location.startsWith(r));

  const { data: equipment } = useQuery({
    queryKey: ["/api/equipment"],
    queryFn: api.equipment.list,
    enabled: !!userId && !isFullscreen,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const { data: alertAcks } = useQuery({
    queryKey: ["/api/alert-acks"],
    queryFn: api.alertAcks.list,
    enabled: !!userId && !isFullscreen,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  if (isFullscreen) return null;

  const alerts = equipment ? computeAlerts(equipment) : [];
  const alertAckSet = buildAlertAckSet(alertAcks);
  const alertCount = countActiveAlerts(alerts, alertAckSet);

  return (
    <header
      style={{
        // Total height = status bar + 44px nav bar
        height: "calc(44px + env(safe-area-inset-top))",
        // Push flex children below the status bar
        paddingTop: "env(safe-area-inset-top)",
        paddingInline: 12,
        display: "flex",
        alignItems: "center",
        flexShrink: 0,
        // position: relative so the absolutely-positioned wordmark anchors here
        position: "relative",
        background: "hsl(var(--background) / 0.94)",
        borderBottom: "0.5px solid hsl(var(--border))",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      {/* CENTER: VetTrack wordmark — absolutely positioned in the 44px content zone */}
      {/* dir="ltr" forces LTR inline ordering — without it, RTL bidi reorders
          the "Vet" text node and <span>Track</span> to visually appear as "TrackVet". */}
      <div
        dir="ltr"
        style={{
          position: "absolute",
          // Start from the content area top (below status bar)
          top: "env(safe-area-inset-top)",
          // Span the 44px nav bar height
          height: 44,
          // Centered horizontally
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          fontWeight: 700,
          fontSize: 17,
          letterSpacing: "-0.02em",
          color: "hsl(var(--foreground))",
          pointerEvents: "none",
          userSelect: "none",
          whiteSpace: "nowrap",
        }}
      >
        Vet<span style={{ color: "hsl(var(--primary))" }}>Track</span>
      </div>

      {/* END side (left in RTL, right in LTR): icon buttons */}
      <div style={{ display: "flex", gap: 4, marginInlineStart: "auto" }}>
        <button
          type="button"
          aria-label={t.nav.settings}
          onClick={() => navigate("/settings")}
          style={iconBtn}
        >
          <Settings size={20} color="hsl(var(--foreground))" strokeWidth={1.8} />
        </button>

        <button
          type="button"
          aria-label={t.nav.profile}
          onClick={() => navigate("/my-profile")}
          style={{
            ...iconBtn,
            background: "hsl(var(--primary))",
            borderRadius: "50%",
            color: "hsl(var(--primary-foreground))",
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "-0.01em",
          }}
        >
          {getInitials(name)}
        </button>

        <button
          type="button"
          aria-label={t.nav.alerts}
          onClick={() => navigate("/alerts")}
          style={{ ...iconBtn, position: "relative" }}
        >
          <Bell size={20} color="hsl(var(--foreground))" strokeWidth={1.8} />
          {alertCount > 0 && (
            <span
              aria-label={`${alertCount} ${t.nav.alerts}`}
              style={{
                position: "absolute",
                top: 2,
                insetInlineEnd: 2,
                minWidth: 16,
                height: 16,
                borderRadius: 8,
                background: "var(--destructive)",
                color: "#fff",
                fontSize: 10,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                paddingInline: 3,
                lineHeight: 1,
              }}
            >
              {alertCount > 99 ? "99+" : alertCount}
            </span>
          )}
        </button>
      </div>
    </header>
  );
}

const iconBtn: React.CSSProperties = {
  width: 36,
  height: 36,
  border: "none",
  background: "transparent",
  borderRadius: 10,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  WebkitTapHighlightColor: "transparent",
};
