// src/components/layout/Topbar.tsx
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useDirection } from "@/hooks/useDirection";
import { isPilotMode } from "@/lib/pilot-mode";

export interface TopbarSection {
  href: string;
  label: string;
  adminOnly?: boolean;
  pilotHidden?: boolean;
}

const SECTIONS: TopbarSection[] = [
  { href: "/home",         label: "Home" },
  { href: "/patients",     label: "Patients",  pilotHidden: true },
  { href: "/equipment",    label: "Equipment" },
  { href: "/meds",         label: "Pharmacy",  pilotHidden: true },
  { href: "/appointments", label: "Shifts",    pilotHidden: true },
  { href: "/display",      label: "Ward" },
  { href: "/admin",        label: "Admin", adminOnly: true },
];

export function Topbar() {
  const [location] = useLocation();
  const { isAdmin, name, activeShift } = useAuth();
  const dir = useDirection();

  const visibleSections = SECTIONS.filter((s) =>
    (!s.adminOnly || isAdmin) && (!isPilotMode || !s.pilotHidden)
  );

  // Match the most specific prefix
  const activeHref =
    visibleSections
      .slice()
      .sort((a, b) => b.href.length - a.href.length)
      .find((s) => location.startsWith(s.href))?.href ?? "";

  return (
    <header
      dir={dir}
      className="h-10 bg-ivory-navy border-b-2 border-[#0a1509] flex items-center px-4 gap-0.5 shrink-0"
    >
      {/* Logo */}
      <Link
        href="/home"
        className="text-[13.5px] font-bold tracking-[-0.03em] text-white me-4 shrink-0"
      >
        Vet<em className="text-[#4cde6a] not-italic">Track</em>
      </Link>

      {/* Section nav */}
      <nav className="flex items-center gap-0.5 flex-1 overflow-x-auto">
        {visibleSections.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className={cn(
              "text-[12px] font-medium px-2.5 py-1 rounded-[4px] whitespace-nowrap transition-colors duration-100",
              activeHref === s.href
                ? "bg-ivory-green text-white font-semibold"
                : "text-[#8ab89a] hover:text-[#bbd8c0]"
            )}
          >
            {s.label}
          </Link>
        ))}
      </nav>

      {/* Right controls */}
      <div className="flex items-center gap-2.5 ms-auto shrink-0">
        <ShiftBadge activeShift={activeShift} />
        <UserAvatar name={name} />
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
    <span className="text-[11px] font-medium bg-white/[0.08] border border-white/10 text-[#8ab89a] px-2.5 py-0.5 rounded-full">
      {activeShift.startTime}–{activeShift.endTime}
    </span>
  );
}

function UserAvatar({ name }: { name: string | null }) {
  const initials = name
    ? name
        .split(" ")
        .map((p) => p[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "??";
  return (
    <div className="w-7 h-7 rounded-full bg-ivory-green flex items-center justify-center text-[10.5px] font-bold text-white select-none shrink-0">
      {initials}
    </div>
  );
}
