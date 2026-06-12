// Single source of truth for primary navigation. Both Topbar and Sidebar (T2.2)
// and the mobile bottom-nav (T2.5) consume THIS and nothing else.
export interface NavNode {
  id: string;
  /** i18n key under nav.*, resolved at render. Never a literal string. */
  labelKey: string;
  href: string;
  icon: string; // lucide-react icon name
  adminOnly?: boolean;
  children?: NavNode[];
}

export const NAV: NavNode[] = [
  { id: "today", labelKey: "nav.today", href: "/home", icon: "Home" },
  {
    id: "equipment",
    labelKey: "nav.equipment",
    href: "/equipment",
    icon: "Package",
    children: [
      { id: "eq-list",  labelKey: "nav.equipmentAll",   href: "/equipment",        icon: "List" },
      { id: "eq-tasks", labelKey: "nav.equipmentTasks",  href: "/equipment/tasks",  icon: "ListTodo" }, // aliases /appointments
      { id: "eq-scan",  labelKey: "nav.equipmentScan",   href: "/equipment?scan=1", icon: "Scan" },
      { id: "eq-new",   labelKey: "nav.equipmentNew",    href: "/equipment/new",    icon: "Plus" },
    ],
  },
  { id: "board",  labelKey: "nav.board",  href: "/equipment/board", icon: "Grid" }, // aliases /display
  { id: "alerts", labelKey: "nav.alerts", href: "/alerts",          icon: "Bell" },
  { id: "rooms",  labelKey: "nav.rooms",  href: "/rooms",           icon: "MapPin" },
  {
    id: "admin",
    labelKey: "nav.admin",
    href: "/admin",
    icon: "Settings",
    adminOnly: true,
    children: [
      { id: "ad-metrics", labelKey: "nav.adminMetrics", href: "/admin/metrics",       icon: "Gauge" },
      { id: "ad-types",   labelKey: "nav.adminTypes",   href: "/admin/asset-types",   icon: "Boxes" },
      { id: "ad-shifts",  labelKey: "nav.adminShifts",  href: "/admin/shifts",        icon: "Clock" },
    ],
  },
];

/** Flattened list of every nav href (for active-state + dead-link tests). */
export const NAV_HREFS: string[] = NAV.flatMap((n) => [
  n.href,
  ...(n.children?.map((c) => c.href) ?? []),
]);
