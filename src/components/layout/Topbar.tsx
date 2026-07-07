// src/components/layout/Topbar.tsx
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { cn, computeAlerts } from "@/lib/utils";
import { buildAlertAckSet, countActiveAlerts, filterUnackedAlerts } from "@/lib/alert-counts";
import { useAuth } from "@/hooks/use-auth";
import { useExperience } from "@/hooks/use-experience";
import { filterAdminNav } from "@/lib/roles/experience-model";
import { visibleWebManagementNav } from "@/lib/routes/web-management-nav-model";
import { useDirection } from "@/hooks/useDirection";
import { resolveNavItemActive } from "@/lib/routes/resolve-nav-active";
import { NAV } from "@/lib/routes/nav-model";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import { getInitials } from "@/lib/user-utils";
import { AlertsDropdown } from "@/components/alerts-dropdown";
import { TopbarSettingsMenu } from "@/components/layout/TopbarSettingsMenu";
import { TopbarSearch } from "@/components/layout/TopbarSearch";

function navLabel(key: string): string {
  const k = key.startsWith("nav.") ? key.slice(4) : key;
  return (t.nav as Record<string, string>)[k] ?? key;
}

export function Topbar() {
  const [location] = useLocation();
  const { name, activeShift, userId } = useAuth();
  const experience = useExperience();
  const dir = useDirection();
  const signedIn = Boolean(userId);

  // Alerts bell + unread badge (parity with the legacy layout topbar and the
  // mobile NativeHeader — the shell migration to PageShell/Topbar dropped it).
  const { data: equipment } = useQuery({
    queryKey: ["/api/equipment"],
    queryFn: api.equipment.list,
    enabled: signedIn,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const { data: alertAcks } = useQuery({
    queryKey: ["/api/alert-acks"],
    queryFn: api.alertAcks.list,
    enabled: signedIn,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const alerts = equipment ? computeAlerts(equipment) : [];
  const alertAckSet = buildAlertAckSet(alertAcks);
  const alertCount = countActiveAlerts(alerts, alertAckSet);

  const [badgeAnimating, setBadgeAnimating] = useState(false);
  const prevAlertCount = useRef(alertCount);
  useEffect(() => {
    if (alertCount > prevAlertCount.current) {
      setBadgeAnimating(true);
      const id = setTimeout(() => setBadgeAnimating(false), 450);
      prevAlertCount.current = alertCount;
      return () => clearTimeout(id);
    }
    prevAlertCount.current = alertCount;
  }, [alertCount]);

  const visibleItems = filterAdminNav(NAV, experience);
  const managementItems = visibleWebManagementNav(experience);

  const activeHref =
    [...visibleItems, ...managementItems]
      .slice()
      .sort((a, b) => b.href.length - a.href.length)
      .find((n) => resolveNavItemActive(location, n.href))?.href ?? "";

  const renderNavLink = (n: { id: string; href: string; labelKey: string }) => (
    <Link
      key={n.id}
      href={n.href}
      className={cn(
        "text-sm font-medium px-2.5 py-1 rounded-[4px] whitespace-nowrap transition-colors duration-100",
        activeHref === n.href
          ? "bg-indigo-600 text-white font-semibold"
          : "text-white/60 hover:text-white/85"
      )}
    >
      {navLabel(n.labelKey)}
    </Link>
  );

  return (
    <header
      dir={dir}
      className="h-10 bg-[var(--brand-navy)] border-b-2 border-black/40 flex items-center px-4 gap-0.5 shrink-0"
    >
      {/* Logo */}
      <Link
        href="/home"
        className="text-sm font-bold tracking-[-0.03em] text-white me-4 shrink-0"
      >
        Vet<em className="text-[var(--brand-green-bright)] not-italic">Track</em>
      </Link>

      {/* Primary nav */}
      <nav className="flex items-center gap-0.5 flex-1 overflow-x-auto">
        {visibleItems.map(renderNavLink)}
        {managementItems.length > 0 && (
          <span className="mx-1 h-4 w-px shrink-0 bg-white/20" aria-hidden="true" />
        )}
        {managementItems.map(renderNavLink)}
      </nav>

      {/* Right controls */}
      <div className="flex items-center gap-1.5 ms-auto shrink-0">
        <TopbarSearch />
        <ShiftBadge activeShift={activeShift} />
        {signedIn && (
          // Unacked-only, matching NativeHeader — the badge counts unacked,
          // so the panel must not list acked rows the badge ignores.
          <AlertsDropdown
            alerts={filterUnackedAlerts(alerts, alertAckSet)}
            alertCount={alertCount}
            badgeAnimating={badgeAnimating}
            buttonClassName="h-8 w-8 min-h-0 min-w-0"
          />
        )}
        <TopbarSettingsMenu />
        <UserAvatar name={name} enabled={signedIn} />
      </div>
    </header>
  );
}

function ShiftBadge({
  activeShift,
}: {
  activeShift: { startTime: string; endTime: string } | null | undefined;
}) {
  if (!activeShift) return null;
  return (
    <span className="text-xs font-medium bg-white/[0.08] border border-white/10 text-white/60 px-2.5 py-0.5 rounded-full">
      {activeShift.startTime}–{activeShift.endTime}
    </span>
  );
}

function UserAvatar({ name, enabled }: { name: string | null; enabled: boolean }) {
  const { data: me } = useQuery({
    queryKey: ["/api/users/me"],
    queryFn: api.users.me,
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  return (
    <Link href="/my-profile" aria-label={t.profile.title}>
      {me?.avatarUrl ? (
        <img
          src={me.avatarUrl}
          alt={t.profile.avatarAlt}
          width={28}
          height={28}
          className="w-7 h-7 rounded-full object-cover select-none shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
        />
      ) : (
        <div className="w-7 h-7 rounded-full bg-ivory-green flex items-center justify-center text-xs font-bold text-white select-none shrink-0 cursor-pointer hover:opacity-80 transition-opacity">
          {getInitials(name)}
        </div>
      )}
    </Link>
  );
}
