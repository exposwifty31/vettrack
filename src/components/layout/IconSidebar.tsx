// src/components/layout/IconSidebar.tsx
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useDirection } from "@/hooks/useDirection";
import type { LucideIcon } from "lucide-react";
import { resolveNavItemActive } from "@/lib/routes/resolve-nav-active";

export interface SidebarItem {
  href: string;
  icon: LucideIcon;
  label: string;
  alertDot?: boolean;
}

interface IconSidebarProps {
  items: SidebarItem[];
}

export function IconSidebar({ items }: IconSidebarProps) {
  const [location] = useLocation();
  const dir = useDirection();

  // In RTL: sidebar border moves to inline-end (left in RTL = end in RTL)
  const borderClass =
    dir === "rtl" ? "border-e border-ivory-border" : "border-s border-ivory-border";

  return (
    <aside
      dir={dir}
      className={cn(
        "w-11 bg-[#f0ede6] flex flex-col items-center py-3 gap-1 shrink-0",
        borderClass
      )}
    >
      {items.map((item) => {
        const isActive = resolveNavItemActive(location, item.href);
        const Icon = item.icon;
        return (
          <Link key={item.href} href={item.href}>
            <span
              title={item.label}
              className={cn(
                "relative w-[30px] h-[30px] rounded-[6px] flex items-center justify-center transition-colors duration-100 cursor-pointer",
                isActive
                  ? "bg-ivory-greenBg text-ivory-green"
                  : "text-[#aab8ac] hover:text-ivory-text3"
              )}
            >
              <Icon size={15} strokeWidth={2.2} />
              {item.alertDot && (
                <span className="absolute top-[3px] end-[3px] w-1.5 h-1.5 rounded-full bg-ivory-err border-[1.5px] border-[#f0ede6]" />
              )}
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
