import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { AlertTriangle, DoorOpen, Siren, Wrench } from "lucide-react";
import { api } from "@/lib/api";
import { getCurrentUserId } from "@/lib/auth-store";
import { useAuth } from "@/hooks/use-auth";
import { subscribeKeepalive } from "@/lib/realtime";
import { useAlertsController } from "@/features/alerts";
import { OnShiftHero, type HeroState } from "./surfaces/OnShiftHero";
import { Bdi } from "@/components/ui/bdi";
import { ForwardChevron } from "@/components/ui/directional-chevron";
import { equipmentTriageTier } from "@/lib/design-tokens";
import { isInactive } from "@/lib/utils";
import { INACTIVE_THRESHOLD_DAYS } from "../../../shared/constants";
import { t, formatDateByLocale } from "@/lib/i18n";
import type { Alert, Room } from "@/types";

/** Same time-of-day greeting the phone Home uses (helper is page-local there). */
function greetingFor(hour: number, name: string): string {
  if (hour < 12) return t.homePage.greetingMorning(name);
  if (hour < 18) return t.homePage.greetingAfternoon(name);
  return t.homePage.greetingEvening(name);
}

const ALERT_ORDER: Alert["type"][] = ["issue", "overdue", "sterilization_due", "inactive"];

function roomPct(room: Room): number | null {
  const total = room.totalEquipment ?? 0;
  if (total === 0) return null;
  return Math.round(((room.recentlyVerifiedCount ?? 0) / total) * 100);
}

function pctColor(pct: number): string {
  if (pct >= 80) return "rgb(var(--sys-green))";
  if (pct >= 40) return "rgb(var(--sys-orange))";
  return "rgb(var(--sys-red))";
}

const tileStyle: React.CSSProperties = {
  borderRadius: 20,
  border: "1px solid hsl(var(--border))",
  background: "hsl(var(--card))",
  padding: "16px 18px",
  display: "flex",
  flexDirection: "column",
  gap: 12,
  minWidth: 0,
};

function TileHeader({ title, href, aside }: { title: string; href: string; aside?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <Link
        href={href}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          fontSize: "var(--text-sm)",
          fontWeight: 700,
          color: "hsl(var(--foreground))",
          textDecoration: "none",
        }}
      >
        {title}
        <ForwardChevron size={14} className="opacity-50" />
      </Link>
      {aside}
    </div>
  );
}

function SkeletonRows({ rows }: { rows: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ height: 14, borderRadius: 7, background: "hsl(var(--muted))" }} />
      ))}
    </div>
  );
}

/**
 * iPad Home (M3). The phone page rendered capped at 720px on tablet — a
 * greeting, one card, and empty space. This dashboard externalizes clinic
 * context by composing the surfaces the earlier phases reconciled: the roster
 * shift hero, the equipment availability + not-verified split (same
 * `isInactive` predicate as the alert bell, Phase 2), the worst-first alert
 * feed (shared `useAlertsController`, Phase 3), and room verification bars.
 * No new endpoints; every tile navigates to its full surface.
 */
export function HomeTabletDashboard() {
  const { name } = useAuth();
  const userId = getCurrentUserId();
  const [, navigate] = useLocation();
  const [activeCodeBlueId, setActiveCodeBlueId] = useState<string | null>(null);

  useEffect(
    () =>
      subscribeKeepalive(({ activeCodeBlueSessionId }) => {
        setActiveCodeBlueId(activeCodeBlueSessionId);
      }),
    [],
  );

  const { data: pulse, isLoading: pulseLoading } = useQuery({
    queryKey: ["/api/home/dashboard"],
    queryFn: () => api.home.dashboard(),
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: 120_000,
  });

  const { data: equipment, isLoading: equipmentLoading } = useQuery({
    queryKey: ["/api/equipment"],
    queryFn: api.equipment.list,
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const { data: rooms, isLoading: roomsLoading } = useQuery({
    queryKey: ["/api/rooms"],
    queryFn: api.rooms.list,
    staleTime: 30_000,
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const alertsCtl = useAlertsController();

  const equipmentFigures = useMemo(() => {
    if (!equipment) return null;
    let attention = 0;
    for (const eq of equipment) {
      if (equipmentTriageTier(eq) === "attention") attention++;
    }
    const notVerified = equipment.filter(isInactive).length;
    const total = equipment.length;
    return {
      total,
      attention,
      notVerified,
      verified: total - notVerified,
      availabilityPct: total > 0 ? Math.round(((total - attention) / total) * 100) : null,
    };
  }, [equipment]);

  const topAlerts = useMemo(() => {
    const active = alertsCtl.alerts.filter(
      (a) => !alertsCtl.acksMap.has(`${a.equipmentId}:${a.type}`),
    );
    return [...active]
      .sort((a, b) => ALERT_ORDER.indexOf(a.type) - ALERT_ORDER.indexOf(b.type))
      .slice(0, 3);
  }, [alertsCtl.alerts, alertsCtl.acksMap]);

  const worstRooms = useMemo(() => {
    if (!rooms) return [];
    return rooms
      .map((room) => ({ room, pct: roomPct(room) }))
      .filter((r): r is { room: Room; pct: number } => r.pct !== null)
      .sort((a, b) => a.pct - b.pct)
      .slice(0, 5);
  }, [rooms]);

  const itemsOut = equipment
    ? equipment.filter((e) => e.custodyState === "checked_out").length
    : 0;

  // Roster-derived on-shift state, mirroring use-ops-home (pulse present iff inside
  // a scheduled window). Matches the phone/web surfaces' OnShiftHero contract.
  const heroState: HeroState = pulse
    ? pulse.shift
      ? "active"
      : "noshift"
    : pulseLoading
      ? "loading"
      : "noshift";

  const firstName = name?.split(" ")[0] || t.homePage.fallbackName;
  const greeting = greetingFor(new Date().getHours(), firstName);
  const dateLine = formatDateByLocale(new Date(), {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const availability = equipmentFigures?.availabilityPct ?? null;

  return (
    <div
      data-testid="home-tablet-dashboard"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: 16,
        width: "100%",
        maxWidth: 1200,
        margin: "0 auto",
        padding: "16px 20px calc(24px + env(safe-area-inset-bottom))",
      }}
    >
      <Helmet>
        <title>Dashboard — VetTrack</title>
      </Helmet>

      <header style={{ gridColumn: "1 / -1" }}>
        <h1
          style={{
            fontSize: "var(--text-2xl)",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            color: "hsl(var(--foreground))",
            margin: 0,
            lineHeight: 1.1,
          }}
        >
          <Bdi>{greeting}</Bdi>
        </h1>
        <p style={{ margin: "6px 0 0", fontSize: "var(--text-sm)", fontWeight: 500, color: "hsl(var(--muted-foreground))" }}>
          {dateLine}
        </p>
      </header>

      {/* Code Blue active — rare, safety-critical, above the tiles. Display
          only, keepalive-driven (frozen-surface safe). */}
      {activeCodeBlueId && (
        <button
          type="button"
          onClick={() => navigate("/code-blue")}
          style={{
            gridColumn: "1 / -1",
            display: "flex",
            alignItems: "center",
            gap: 12,
            borderRadius: 14,
            border: "1px solid rgb(var(--sys-red) / 0.3)",
            background: "rgb(var(--sys-red) / 0.12)",
            padding: "12px 16px",
            cursor: "pointer",
            textAlign: "start",
          }}
        >
          <span
            style={{
              display: "flex",
              width: 36,
              height: 36,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 10,
              background: "rgb(var(--sys-red))",
              color: "#fff",
              flexShrink: 0,
            }}
          >
            <Siren size={18} aria-hidden />
          </span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 700, color: "rgb(var(--sys-red))" }}>
              {t.homePage.urgentCodeBlue}
            </span>
            <span style={{ display: "block", fontSize: "var(--text-xs)", color: "hsl(var(--muted-foreground))" }}>
              {t.homePage.urgentCodeBlueHint}
            </span>
          </span>
          <ForwardChevron size={16} style={{ color: "rgb(var(--sys-red))", opacity: 0.7, flexShrink: 0 }} />
        </button>
      )}

      {/* Shift — the roster-derived hero, the SAME component the phone/web Today
          surfaces use. On-shift is roster-derived (no self-start affordance); the
          iPad was the last surface still on the legacy button-bearing ShiftHero
          (Phase 10 F4). */}
      <OnShiftHero
        pulse={pulse}
        itemsOut={itemsOut}
        scansDone={pulse?.scansToday ?? 0}
        heroState={heroState}
      />

      {/* Equipment — availability + the Phase-2 not-verified reconciliation. */}
      <section style={tileStyle} data-testid="tablet-tile-equipment">
        <TileHeader title={t.nav.equipment} href="/equipment" />
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span
            data-testid="tablet-equipment-availability"
            style={{
              fontFamily: "var(--font-num)",
              fontSize: 40,
              fontWeight: 700,
              letterSpacing: "-0.03em",
              lineHeight: 1,
              color:
                availability === null
                  ? "hsl(var(--muted-foreground))"
                  : availability >= 80
                    ? "rgb(var(--sys-green))"
                    : "rgb(var(--sys-orange))",
            }}
          >
            {availability === null ? "—" : `${availability}%`}
          </span>
          <span style={{ fontSize: "var(--text-xs)", fontWeight: 600, color: "hsl(var(--muted-foreground))" }}>
            {t.equipmentList.uptimeLabel}
          </span>
        </div>
        {equipmentLoading && !equipmentFigures ? (
          <SkeletonRows rows={2} />
        ) : equipmentFigures ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {equipmentFigures.notVerified > 0 && (
              <p style={{ margin: 0, fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--status-stale-fg)" }}>
                {t.equipmentList.verifiedSplit(
                  equipmentFigures.verified,
                  equipmentFigures.notVerified,
                  INACTIVE_THRESHOLD_DAYS,
                )}
              </p>
            )}
            <p style={{ margin: 0, display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-sm)", color: equipmentFigures.attention > 0 ? "var(--status-issue-fg)" : "hsl(var(--muted-foreground))" }}>
              <Wrench size={14} aria-hidden />
              {equipmentFigures.attention} {t.equipmentList.statAttention}
              <span style={{ color: "hsl(var(--muted-foreground))" }}>
                · {equipmentFigures.total} {t.equipmentList.statTotal}
              </span>
            </p>
          </div>
        ) : null}
      </section>

      {/* Exceptions — worst-first head of the shared controller feed (Phase 3).
          Titled to match the canonical phone/web ExceptionsTile (mobile is the
          source of truth); the Alerts nav entry is a separate destination. */}
      <section style={tileStyle} data-testid="tablet-tile-alerts">
        <TileHeader
          title={t.homeSurface.exceptions}
          href="/alerts"
          aside={
            alertsCtl.activeAlertCount > 0 ? (
              <span
                dir="ltr"
                style={{
                  minWidth: 22,
                  height: 22,
                  padding: "0 7px",
                  borderRadius: 11,
                  background: "rgb(var(--sys-red))",
                  color: "#fff",
                  fontSize: "var(--text-2xs)",
                  fontWeight: 700,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {alertsCtl.activeAlertCount > 99 ? "99+" : alertsCtl.activeAlertCount}
              </span>
            ) : null
          }
        />
        {alertsCtl.isLoading ? (
          <SkeletonRows rows={3} />
        ) : topAlerts.length === 0 ? (
          <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "hsl(var(--muted-foreground))" }}>
            {t.alerts.empty.message}
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {topAlerts.map((alert) => (
              <button
                key={`${alert.equipmentId}:${alert.type}`}
                type="button"
                onClick={() => navigate(`/equipment/${alert.equipmentId}`)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  minHeight: 44,
                  padding: "6px 8px",
                  margin: "0 -8px",
                  borderRadius: 12,
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  textAlign: "start",
                }}
              >
                <AlertTriangle
                  size={16}
                  aria-hidden
                  style={{
                    flexShrink: 0,
                    color:
                      alert.type === "issue"
                        ? "var(--status-issue-fg)"
                        : alert.type === "overdue"
                          ? "var(--status-stale-fg)"
                          : "hsl(var(--muted-foreground))",
                  }}
                />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span
                    dir="auto"
                    style={{
                      display: "block",
                      fontSize: "var(--text-sm)",
                      fontWeight: 600,
                      color: "hsl(var(--foreground))",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <Bdi>{alert.equipmentName}</Bdi>
                  </span>
                  <span
                    style={{
                      display: "block",
                      fontSize: "var(--text-xs)",
                      color: "hsl(var(--muted-foreground))",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {alert.detail}
                  </span>
                </span>
                <ForwardChevron size={14} className="opacity-40" style={{ flexShrink: 0 }} />
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Rooms — verification readiness bars, worst first. */}
      <section style={tileStyle} data-testid="tablet-tile-rooms">
        <TileHeader title={t.nav.rooms} href="/rooms" />
        {roomsLoading && !rooms ? (
          <SkeletonRows rows={4} />
        ) : worstRooms.length === 0 ? (
          <p style={{ margin: 0, display: "flex", alignItems: "center", gap: 8, fontSize: "var(--text-sm)", color: "hsl(var(--muted-foreground))" }}>
            <DoorOpen size={16} aria-hidden />
            {t.roomsListPage.healthRingHelp}
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {worstRooms.map(({ room, pct }) => (
              <Link
                key={room.id}
                href={`/rooms/${room.id}`}
                style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", minHeight: 32 }}
                title={t.roomsListPage.healthRingTitle(pct)}
              >
                <span
                  dir="auto"
                  style={{
                    width: "34%",
                    minWidth: 0,
                    fontSize: "var(--text-sm)",
                    fontWeight: 600,
                    color: "hsl(var(--foreground))",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  <Bdi>{room.name}</Bdi>
                </span>
                <span style={{ flex: 1, height: 8, borderRadius: 4, background: "hsl(var(--muted))", overflow: "hidden" }}>
                  <span
                    style={{
                      display: "block",
                      height: "100%",
                      width: `${pct}%`,
                      borderRadius: 4,
                      background: pctColor(pct),
                    }}
                  />
                </span>
                <span
                  dir="ltr"
                  style={{
                    width: 42,
                    textAlign: "end",
                    fontFamily: "var(--font-num)",
                    fontSize: "var(--text-sm)",
                    fontWeight: 700,
                    color: pctColor(pct),
                    flexShrink: 0,
                  }}
                >
                  {pct}%
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
