import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Settings, Bell, Moon, Globe, User, AlertCircle, AlertTriangle, MessageCircle } from "lucide-react";
import { ForwardChevron } from "@/components/ui/directional-chevron";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { useIsDarkActive, useSettings } from "@/hooks/use-settings";
import { computeAlerts } from "@/lib/utils";
import { buildAlertAckSet, countActiveAlerts, filterUnackedAlerts } from "@/lib/alert-counts";
import { aggregateAlerts, formatBadgeCount } from "@/lib/attention";
import { t } from "@/lib/i18n";
import { getInitials } from "@/lib/user-utils";
import { useIsTabletViewport } from "@/lib/use-tablet-viewport";
import { EquipmentSearchBox } from "@/components/search/EquipmentSearchBox";
import { EquipmentSearchButton } from "@/components/search/EquipmentSearchButton";
import { ShiftChatLauncher } from "@/features/shift-chat/components/ShiftChatLauncher";

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
  const isDarkNow = useIsDarkActive();
  const isTablet = useIsTabletViewport();
  // Fall back to initials if the presigned avatar URL fails to load (a broken img
  // renders as a "?" placeholder on iOS WebKit).
  const [avatarError, setAvatarError] = useState(false);
  const [openPanel, setOpenPanel] = useState<Panel>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Panels are dropdowns of plain buttons (not an ARIA menu with roving focus),
  // but they must still honor Escape-to-close and move/return focus for keyboard
  // and screen-reader users.
  useEffect(() => {
    if (!openPanel) return;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenPanel(null);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openPanel]);

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

  const { data: me } = useQuery({
    queryKey: ["/api/users/me"],
    queryFn: api.users.me,
    enabled: !!userId && !isFullscreen,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  if (isFullscreen) return null;

  const alerts = equipment ? computeAlerts(equipment) : [];
  const alertAckSet = buildAlertAckSet(alertAcks);
  const alertCount = countActiveAlerts(alerts, alertAckSet);
  const alertGroups = aggregateAlerts(filterUnackedAlerts(alerts, alertAckSet));

  function go(href: string) {
    setOpenPanel(null);
    navigate(href);
  }

  return (
    <>
      <header
        style={{
          // Total height = status bar + 48px nav bar (tablet: shell owns the inset → just 48px)
          height: ownSafeArea ? "calc(48px + env(safe-area-inset-top))" : 48,
          // Push flex children below the status bar
          paddingTop: ownSafeArea ? "env(safe-area-inset-top)" : 0,
          // Horizontal safe areas: landscape iPhone puts the camera housing on
          // a side edge — leading/trailing controls must clear it (H4).
          paddingLeft: "calc(12px + env(safe-area-inset-left))",
          paddingRight: "calc(12px + env(safe-area-inset-right))",
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
        {/* LEADING: equipment search — inline typeahead field on tablet, icon→overlay on phone */}
        {isTablet ? (
          <div style={{ flex: 1, maxWidth: 460, marginInlineEnd: 12 }}>
            <EquipmentSearchBox tone="surface" />
          </div>
        ) : (
          <>
            <EquipmentSearchButton />
            {/* LEADING brand as a home link (logo → Today). Left-aligned so it can't
                collide with the end-side icon group the way the old centered wordmark
                did once chat moved into the header. dir="ltr" keeps "VetTrack" ordered. */}
            {showWordmark && (
              <button
                type="button"
                onClick={() => navigate("/home")}
                aria-label={t.nav.today}
                dir="ltr"
                style={{
                  display: "flex",
                  alignItems: "center",
                  marginInlineStart: 6,
                  padding: "4px 6px",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: 17,
                  letterSpacing: "-0.02em",
                  color: "hsl(var(--foreground))",
                  whiteSpace: "nowrap",
                }}
              >
                Vet<span style={{ color: "hsl(var(--primary))" }}>Track</span>
              </button>
            )}
          </>
        )}

        {/* END side (left in RTL, right in LTR): icon buttons */}
        <div style={{ display: "flex", gap: 4, marginInlineStart: "auto" }}>
          {/* Chat lives in the header on every native/mobile shell (phone + iPad) —
              the floating FAB is desktop-web only. The launcher owns the single
              useShiftChat instance on this device. */}
          <ShiftChatLauncher
              renderTrigger={({ open, unreadCount }) => (
                <button
                  type="button"
                  aria-label={
                    unreadCount > 0
                      ? t.shiftChat.openChatUnread(unreadCount > 9 ? "9+" : String(unreadCount))
                      : t.shiftChat.openChat
                  }
                  onClick={open}
                  style={{ ...iconBtn, position: "relative" }}
                >
                  <MessageCircle size={20} color="hsl(var(--foreground))" strokeWidth={1.8} />
                  {unreadCount > 0 && (
                    <span
                      aria-hidden
                      // Bidi isolation: "9+" visually flips to "+9" in the RTL context.
                      dir="ltr"
                      style={{
                        position: "absolute",
                        top: 2,
                        insetInlineEnd: 2,
                        minWidth: 16,
                        height: 16,
                        borderRadius: 8,
                        background: "hsl(var(--destructive))",
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
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </button>
              )}
            />
          <button
            type="button"
            aria-label={t.nav.settings}
            aria-haspopup="true"
            aria-expanded={openPanel === "settings"}
            onClick={(e) => {
              triggerRef.current = e.currentTarget;
              setOpenPanel((p) => (p === "settings" ? null : "settings"));
            }}
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
            {/* Visible avatar sized (24px) to sit level with the 20px gear/bell
                glyphs, not the 44px hit area — a 28px circle read oversized next
                to them (BUG-006). Muted fill + hairline ring (not a saturated
                --primary fill) so the least-frequent action doesn't out-weigh the
                live-badge alerts control. */}
            {me?.avatarUrl && !avatarError ? (
              <img
                src={me.avatarUrl}
                alt={t.profile.avatarAlt}
                onError={() => setAvatarError(true)}
                width={24}
                height={24}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  objectFit: "cover",
                  border: "1px solid hsl(var(--border))",
                  display: "block",
                }}
              />
            ) : (
              <span
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  background: "hsl(var(--muted))",
                  color: "hsl(var(--foreground))",
                  border: "1px solid hsl(var(--border))",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "-0.01em",
                }}
              >
                {getInitials(me?.displayName || me?.name || name)}
              </span>
            )}
          </button>

          <button
            type="button"
            aria-label={alertCount > 0 ? `${alertCount} ${t.nav.alerts}` : t.nav.alerts}
            aria-haspopup="true"
            aria-expanded={openPanel === "alerts"}
            onClick={(e) => {
              triggerRef.current = e.currentTarget;
              setOpenPanel((p) => (p === "alerts" ? null : "alerts"));
            }}
            style={{ ...iconBtn, position: "relative" }}
          >
            <Bell size={20} color="hsl(var(--foreground))" strokeWidth={1.8} />
            {alertCount > 0 && (
              <span
                aria-hidden
                // Bidi isolation: "9+" visually flips to "+9" in the RTL context
                // (confirmed on-device in the 2026-07-03 simulator pass).
                dir="ltr"
                style={{
                  position: "absolute",
                  top: 2,
                  insetInlineEnd: 2,
                  minWidth: 16,
                  height: 16,
                  borderRadius: 8,
                  background: "hsl(var(--destructive))",
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
                {formatBadgeCount(alertCount)}
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
            <div ref={panelRef} tabIndex={-1} aria-label={t.nav.alertsTitle} style={panelStyle}>
              <p style={panelHeaderStyle}>{t.nav.alertsTitle}</p>
              {alertGroups.length === 0 ? (
                <p style={emptyStyle}>{t.nav.noActiveAlerts}</p>
              ) : (
                alertGroups.map((group) => (
                  <button
                    key={group.type}
                    type="button"
                    onClick={() => go(group.count === 1 ? `/equipment/${group.alerts[0]!.equipmentId}` : "/alerts")}
                    style={rowStyle}
                  >
                    {/* Distinct shape per tier, not color alone (WCAG 1.4.1):
                        critical = round AlertCircle (red), else AlertTriangle. */}
                    {group.tier === "critical" ? (
                      <AlertCircle
                        size={16}
                        strokeWidth={2}
                        aria-hidden
                        style={{ flexShrink: 0, color: "rgb(var(--sys-red))" }}
                      />
                    ) : (
                      <AlertTriangle
                        size={16}
                        strokeWidth={2}
                        aria-hidden
                        style={{ flexShrink: 0, color: group.tier === "urgent" ? "rgb(var(--sys-orange))" : "hsl(var(--muted-foreground))" }}
                      />
                    )}
                    <span style={{ flex: 1, minWidth: 0, textAlign: "start" }}>
                      <span style={rowTitleStyle}>{t.alerts.types[group.type].label}</span>
                      <span style={rowSubStyle}>{t.alerts.itemCount(group.count)}</span>
                    </span>
                    <span style={{ fontSize: "var(--text-sm)", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "hsl(var(--muted-foreground))" }}>{group.count}</span>
                  </button>
                ))
              )}
              <div style={dividerStyle} />
              <button type="button" onClick={() => go("/alerts")} style={footerStyle}>
                <span>{t.nav.seeAllAlerts}</span>
                <ForwardChevron size={16} style={{ opacity: 0.6 }} />
              </button>
            </div>
          ) : (
            <div ref={panelRef} tabIndex={-1} aria-label={t.nav.quickSettings} style={panelStyle}>
              <p style={panelHeaderStyle}>{t.nav.quickSettings}</p>
              <button
                type="button"
                aria-pressed={isDarkNow}
                // Toggle between EXPLICIT light/dark based on what's currently
                // rendered. The old mapping (dark→"system") read as "off" but
                // resolved back to dark on a dark OS — a lossy binary control
                // over a tri-state (device finding, 2026-07-05).
                onClick={() => update({ appearance: isDarkNow ? "light" : "dark" })}
                style={rowStyle}
              >
                <Moon size={18} color="hsl(var(--foreground))" strokeWidth={1.8} />
                <span style={{ flex: 1, textAlign: "start", fontSize: "var(--text-sm)" }}>{t.nav.darkMode}</span>
                <MiniSwitch on={isDarkNow} />
              </button>
              <button
                type="button"
                onClick={() => update({ locale: settings.locale === "he" ? "en" : "he" })}
                style={rowStyle}
              >
                <Globe size={18} color="hsl(var(--foreground))" strokeWidth={1.8} />
                <span style={{ flex: 1, textAlign: "start", fontSize: "var(--text-sm)" }}>{t.nav.language}</span>
                <span style={valueStyle}>{settings.locale === "he" ? t.nav.langHebrewName : t.nav.langEnglishName}</span>
              </button>
              <div style={dividerStyle} />
              <button type="button" onClick={() => go("/my-profile")} style={rowStyle}>
                <User size={18} color="hsl(var(--foreground))" strokeWidth={1.8} />
                <span style={{ flex: 1, textAlign: "start", fontSize: "var(--text-sm)" }}>{t.nav.profile}</span>
                <ForwardChevron size={16} style={{ opacity: 0.6 }} />
              </button>
              <button type="button" onClick={() => go("/settings")} style={footerStyle}>
                <span>{t.nav.allSettings}</span>
                <ForwardChevron size={16} style={{ opacity: 0.6 }} />
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
  // 48px hit area (VetTrack convention, above the 44pt iOS HIG floor); glyphs stay 20px.
  width: 48,
  height: 48,
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
  top: "calc(env(safe-area-inset-top) + 50px)",
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
  outline: "none",
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
  minHeight: 48,
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
  minHeight: 48,
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
