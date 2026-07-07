// src/components/layout/IconSidebar.tsx
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useDirection } from "@/hooks/useDirection";
import type { LucideIcon } from "lucide-react";
import {
  Home, Package, Grid, Bell, MapPin, Settings,
  List, ListTodo, Scan, Plus, Activity, Gauge, Boxes, Clock,
} from "lucide-react";
import { resolveNavItemActive } from "@/lib/routes/resolve-nav-active";
import { NAV } from "@/lib/routes/nav-model";
import { useExperience } from "@/hooks/use-experience";
import { filterAdminNav } from "@/lib/roles/experience-model";
import { t } from "@/lib/i18n";

/** Kept for backward compat — PageShell / my-equipment.tsx still reference this type. */
export interface SidebarItem {
  href: string;
  icon: LucideIcon;
  label: string;
  alertDot?: boolean;
}

const ICON_MAP: Record<string, LucideIcon> = {
  Home, Package, Grid, Bell, MapPin, Settings,
  List, ListTodo, Scan, Plus, Activity, Gauge, Boxes, Clock,
};

function navLabel(key: string): string {
  const k = key.startsWith("nav.") ? key.slice(4) : key;
  return (t.nav as Record<string, string>)[k] ?? key;
}

export function IconSidebar() {
  const [location] = useLocation();
  const dir = useDirection();
  const experience = useExperience();

  const visibleItems = filterAdminNav(NAV, experience);

  const borderClass =
    dir === "rtl" ? "border-e border-ivory-border" : "border-s border-ivory-border";

  return (
    <aside
      dir={dir}
      className={cn(
        "w-11 bg-ivory-bg flex flex-col items-center py-3 gap-1 shrink-0",
        borderClass
      )}
    >
      {visibleItems.map((n) => {
        const isActive = resolveNavItemActive(location, n.href);
        const Icon = ICON_MAP[n.icon];
        if (!Icon) return null;
        return (
          <Link key={n.id} href={n.href} aria-label={navLabel(n.labelKey)}>
            <span
              title={navLabel(n.labelKey)}
              className={cn(
                "relative w-[30px] h-[30px] rounded-sm flex items-center justify-center transition-colors duration-100 cursor-pointer",
                isActive
                  ? "bg-ivory-greenBg text-ivory-green"
                  : "text-ivory-text3 hover:text-ivory-text2"
              )}
            >
              <Icon size={15} strokeWidth={2.2} />
            </span>
          </Link>
        );
      })}
    </aside>
  );
}

/** Thin horizontal rule for grouping sidebar icons */
export function SidebarDivider() {
  return <div className="w-[22px] h-px bg-ivory-border my-1" />;
}
