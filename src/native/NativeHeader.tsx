import { useState } from "react";
import { useLocation } from "wouter";
import { Settings, Bell, ChevronRight, Moon, Globe, User } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { useSettings } from "@/hooks/use-settings";
import { computeAlerts } from "@/lib/utils";
import { buildAlertAckSet, countActiveAlerts, filterUnackedAlerts } from "@/lib/alert-counts";
import { t } from "@/lib/i18n";
import { getInitials } from "@/lib/user-utils";

/** Routes that own their own top chrome — hide the shared header for these. */
const FULLSCREEN_ROUTES = ["/code-blue", "/crash-cart", "/scan", "/handoff"];

type Props = {
  /** Show the centered VetTrack wordmark. False on tablet where the sidebar owns it. */
  showWordmark?: boolean;
  /** Reserve env(safe-area-inset-top). False on tablet where the shell already insets. */
  ownSafeArea?: boolean;
};

type Panel = null | "alerts" | "settings";

export function NativeHeader({ showWordmark = true, ownSafeArea = true }: Props = {}) {
  const [location, navigate] = useLocation();
  const { userId, name } = useAuth();
  const { settings, update } = useSettings();
  const [openPanel, setOpenPanel] = useState<Panel>(null);

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
  const recentAlerts = filterUnackedAlerts(alerts, alertAckSet).slice(0, 5);

  function go(href: string) {
    setOpenPanel(null);
    navigate(href);
  }

  return (
    <>
      <header
        style={{
          // Total height = status bar + 44px nav bar (tablet: shell owns the inset → just 44px)
          height: ownSafeArea ? "calc(44px + env(safe-area-inset-top))" : 44,
          // Push flex children below the status bar
          paddingTop: ownSafeArea ? "env(safe-area-inset-top)" : 0,
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
        {showWordmark && (
          <div
            dir="ltr"
            style={{
              position: "absolute",
              top: "env(safe-area-inset-top)",
              height: 44,
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
        )}

        {/* END side (left in RTL, right in LTR): icon buttons */}
        <div style={{ display: "flex", gap: 4, marginInlineStart: "auto" }}>
          <button
            type="button"
            aria-label={t.nav.settings}
            aria-haspopup="menu"
            aria-expanded={openPanel === "settings"}
            onClick={() => setOpenPanel((p) => (p === "settings" ? null : "settings"))}
            style={iconBtn}
          >
            <Settings size={20} color="hsl(var(--foreground))" strokeWidth={1.8} />
          </button>

          <button
            type="button"
            aria-label={t.nav.profile}
            onClick={() => go("/my-profile")}
            style={iconBtn}
          >
            {/* Visible avatar sized to match the 20px gear/bell glyphs, not the 36px hit area. */}
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: "hsl(var(--primary))",
                color: "hsl(var(--primary-foreground))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "-0.01em",
              }}
            >
              {getInitials(name)}
            </span>
          </button>

          <button
            type="button"
            aria-label={t.nav.alerts}
            aria-haspopup="menu"
            aria-expanded={openPanel === "alerts"}
            onClick={() => setOpenPanel((p) => (p === "alerts" ? null : "alerts"))}
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

      {/* Dropdown panels — fixed to the viewport so the header's backdrop-filter
          (a containing block for fixed descendants) doesn't trap them. */}
      {openPanel && (
        <>
          <div aria-hidden onClick={() => setOpenPanel(null)} style={backdropStyle} />
          {openPanel === "alerts" ? (
            <div role="menu" aria-label={t.nav.alertsTitle} style={panelStyle}>
              <p style={panelHeaderStyle}>{t.nav.alertsTitle}</p>
              {recentAlerts.length === 0 ? (
                <p style={emptyStyle}>{t.nav.noActiveAlerts}</p>
              ) : (
                recentAlerts.map((a) => (
                  <button
                    key={`${a.equipmentId}:${a.type}`}
                    type="button"
                    role="menuitem"
                    onClick={() => go(`/equipment/${a.equipmentId}`)}
                    style={rowStyle}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        flexShrink: 0,
                        background: a.type === "issue" ? "rgb(var(--sys-red))" : "rgb(var(--sys-orange))",
                      }}
                    />
                    <span style={{ flex: 1, minWidth: 0, textAlign: "start" }}>
                      <span style={rowTitleStyle}>{a.equipmentName}</span>
                      {a.detail && <span style={rowSubStyle}>{a.detail}</span>}
                    </span>
                  </button>
                ))
              )}
              <div style={dividerStyle} />
              <button type="button" role="menuitem" onClick={() => go("/alerts")} style={footerStyle}>
                <span>{t.nav.seeAllAlerts}</span>
                <ChevronRight size={16} style={{ opacity: 0.6 }} />
              </button>
            </div>
          ) : (
            <div role="menu" aria-label={t.nav.quickSettings} style={panelStyle}>
              <p style={panelHeaderStyle}>{t.nav.quickSettings}</p>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={settings.darkMode}
                onClick={() => update({ darkMode: !settings.darkMode })}
                style={rowStyle}
              >
                <Moon size={18} color="hsl(var(--foreground))" strokeWidth={1.8} />
                <span style={{ flex: 1, textAlign: "start", fontSize: "var(--text-sm)" }}>{t.nav.darkMode}</span>
                <MiniSwitch on={settings.darkMode} />
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => update({ locale: settings.locale === "he" ? "en" : "he" })}
                style={rowStyle}
              >
                <Globe size={18} color="hsl(var(--foreground))" strokeWidth={1.8} />
                <span style={{ flex: 1, textAlign: "start", fontSize: "var(--text-sm)" }}>{t.nav.language}</span>
                <span style={valueStyle}>{settings.locale === "he" ? t.nav.langHebrewName : t.nav.langEnglishName}</span>
              </button>
              <div style={dividerStyle} />
              <button type="button" role="menuitem" onClick={() => go("/my-profile")} style={rowStyle}>
                <User size={18} color="hsl(var(--foreground))" strokeWidth={1.8} />
                <span style={{ flex: 1, textAlign: "start", fontSize: "var(--text-sm)" }}>{t.nav.profile}</span>
                <ChevronRight size={16} style={{ opacity: 0.6 }} />
              </button>
              <button type="button" role="menuitem" onClick={() => go("/settings")} style={footerStyle}>
                <span>{t.nav.allSettings}</span>
                <ChevronRight size={16} style={{ opacity: 0.6 }} />
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}

function MiniSwitch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        width: 36,
        height: 22,
        borderRadius: 11,
        flexShrink: 0,
        position: "relative",
        background: on ? "hsl(var(--primary))" : "hsl(var(--muted))",
        transition: "background 150ms ease",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          insetInlineStart: on ? 16 : 2,
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 1px 2px rgba(0,0,0,0.3)",
          transition: "inset-inline-start 150ms ease",
        }}
      />
    </span>
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

const backdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 60,
};

const panelStyle: React.CSSProperties = {
  position: "fixed",
  top: "calc(env(safe-area-inset-top) + 46px)",
  insetInlineEnd: 12,
  zIndex: 61,
  width: 300,
  maxWidth: "calc(100vw - 24px)",
  background: "hsl(var(--popover))",
  color: "hsl(var(--popover-foreground))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 16,
  boxShadow: "0 18px 48px rgba(0,0,0,0.22)",
  padding: 6,
  overflow: "hidden",
};

const panelHeaderStyle: React.CSSProperties = {
  margin: 0,
  padding: "8px 10px 4px",
  fontSize: "var(--text-2xs)",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "hsl(var(--muted-foreground))",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  minHeight: 44,
  padding: "8px 10px",
  border: "none",
  background: "transparent",
  borderRadius: 10,
  cursor: "pointer",
  color: "hsl(var(--foreground))",
  WebkitTapHighlightColor: "transparent",
};

const rowTitleStyle: React.CSSProperties = {
  display: "block",
  fontSize: "var(--text-sm)",
  fontWeight: 600,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const rowSubStyle: React.CSSProperties = {
  display: "block",
  fontSize: "var(--text-xs)",
  color: "hsl(var(--muted-foreground))",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const emptyStyle: React.CSSProperties = {
  margin: 0,
  padding: "16px 10px",
  textAlign: "center",
  fontSize: "var(--text-sm)",
  color: "hsl(var(--muted-foreground))",
};

const dividerStyle: React.CSSProperties = {
  height: 1,
  background: "hsl(var(--border))",
  margin: "6px 8px",
};

const footerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  width: "100%",
  minHeight: 44,
  padding: "8px 10px",
  border: "none",
  background: "transparent",
  borderRadius: 10,
  cursor: "pointer",
  fontSize: "var(--text-sm)",
  fontWeight: 600,
  color: "hsl(var(--primary))",
  WebkitTapHighlightColor: "transparent",
};

const valueStyle: React.CSSProperties = {
  fontSize: "var(--text-sm)",
  color: "hsl(var(--muted-foreground))",
};
