import type { LucideIcon } from "lucide-react";
import {
  Home, Package, QrCode, Activity, ListTodo, ShieldCheck, MapPin, User,
  Bell, ShoppingCart, Box, Settings, Clock, LogOut, Bug,
} from "lucide-react";
import { t } from "@/lib/i18n";

/**
 * Single source of truth for the native (Capacitor) shell navigation.
 *
 * Consumed by both the iPad sidebar (`NativeTabSidebar`, renders every section)
 * and the phone drawer (`MoreSheet`, which hides `inPhoneTabBar` items because
 * the bottom tab bar already carries them). Do not hardcode nav lists in either
 * renderer — extend this model instead.
 *
 * Labels read `t.*` at call time so a runtime locale switch is reflected; icons
 * are component references rendered at the consumer's chosen size.
 */
export type NativeNavItem = {
  id: string;
  /** Route to navigate to. Omitted for action rows (see `action`). */
  href?: string;
  label: string;
  Icon: LucideIcon;
  /** Destructive styling (e.g. End shift). */
  destructive?: boolean;
  /** Already reachable from the phone bottom tab bar — hidden in the phone drawer. */
  inPhoneTabBar?: boolean;
  /**
   * Row triggers an in-app action instead of navigating. `"report-issue"` opens
   * the bug-report dialog (POSTs a support ticket) — it must NOT link to the
   * static /support info page. Renderers handle this before falling back to href.
   */
  action?: "report-issue";
};

export type NativeNavSection = {
  id: string;
  label: string;
  /** Section is only shown to admins. */
  adminOnly?: boolean;
  items: NativeNavItem[];
};

export function getNativeNavSections(opts?: { hasActiveShift?: boolean }): NativeNavSection[] {
  const sections: NativeNavSection[] = [
    {
      id: "operations",
      label: t.nav.operationsSection,
      items: [
        { id: "today",      href: "/home",            label: t.nav.today,            Icon: Home,         inPhoneTabBar: true },
        { id: "equipment",  href: "/equipment",       label: t.nav.equipment,        Icon: Package,      inPhoneTabBar: true },
        { id: "scan",       href: "/scan",            label: t.nav.equipmentScan,    Icon: QrCode,       inPhoneTabBar: true },
        { id: "emergency",  href: "/code-blue",       label: t.nav.emergency,        Icon: Activity,     inPhoneTabBar: true },
        { id: "tasks",      href: "/equipment/tasks", label: t.nav.equipmentTasks,   Icon: ListTodo },
        { id: "crash-cart", href: "/crash-cart",      label: t.nav.criticalKitCheck, Icon: ShieldCheck },
        { id: "rooms",      href: "/rooms",           label: t.nav.rooms,            Icon: MapPin },
        { id: "mine",       href: "/my-equipment",    label: t.nav.mine,             Icon: User },
        { id: "alerts",     href: "/alerts",          label: t.nav.alerts,           Icon: Bell },
        { id: "inventory",  href: "/inventory",       label: t.nav.inventory,        Icon: ShoppingCart },
      ],
    },
    {
      id: "management",
      label: t.nav.managementSection,
      adminOnly: true,
      items: [
        { id: "inventory-items", href: "/inventory-items", label: t.nav.inventoryItems, Icon: Box },
        { id: "admin",           href: "/admin",           label: t.nav.admin,          Icon: Settings },
        { id: "admin-shifts",    href: "/admin/shifts",    label: t.nav.adminShifts,    Icon: Clock },
      ],
    },
    {
      id: "account",
      label: t.more.account,
      items: [
        { id: "profile",  href: "/my-profile", label: t.more.profile,  Icon: User },
        { id: "settings", href: "/settings",   label: t.more.settings, Icon: Settings },
        // Opens the bug-report dialog (creates a support ticket). NOT the static
        // /support info page — that's the App Store support URL, linked from
        // Settings + the legal footer. (Device finding on build 25, 2026-07-07.)
        { id: "report-bug", action: "report-issue", label: t.nav.reportBug, Icon: Bug },
      ],
    },
    {
      id: "session",
      label: t.more.session,
      items: [
        { id: "end-shift", href: "/handoff", label: t.more.endShift, Icon: LogOut, destructive: true },
      ],
    },
  ];
  // "End shift" while off-shift is a contradiction — handoff needs an active
  // roster shift (M9). Callers that don't know the shift state keep the row.
  if (opts?.hasActiveShift === false) {
    return sections.filter((section) => section.id !== "session");
  }
  return sections;
}

/**
 * Active-item resolution with longest-prefix wins, so `/equipment/tasks` beats
 * `/equipment` and `/admin/shifts` beats `/admin`. `/home` also matches `/`.
 */
export function isNavItemActive(location: string, href: string, allHrefs: string[]): boolean {
  const path = href.split("?")[0];
  if (path === "/home") return location === "/home" || location === "/";
  if (location !== path && !location.startsWith(path + "/")) return false;
  // Not active if a more specific sibling href also matches the location.
  return !allHrefs.some(
    (other) =>
      other !== path &&
      other.startsWith(path + "/") &&
      (location === other || location.startsWith(other + "/")),
  );
}
