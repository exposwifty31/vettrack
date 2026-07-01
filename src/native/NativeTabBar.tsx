import { useLocation } from "wouter";
import { Home, Package, QrCode, Activity, AlignJustify } from "lucide-react";
import { t } from "@/lib/i18n";

type TabDef = {
  id: string;
  href?: string;
  label: string;
  icon: React.ReactNode;
  isScan?: boolean;
  isMore?: boolean;
};

type Props = {
  onMorePress: () => void;
  onScanPress?: () => void;
};

export function isTabActive(location: string, href: string): boolean {
  if (href === "/home") return location === "/home" || location === "/";
  return location.startsWith(href.split("?")[0]);
}

// §6.11: Scan is a flat emphasised tab, never a FAB.
function TabButton({
  label,
  icon,
  active,
  isScan,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  isScan?: boolean;
  onClick: () => void;
}) {
  const color = isScan
    ? "var(--action)"
    : active
    ? "var(--brand)"
    : "hsl(var(--muted-foreground))";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 3,
        paddingTop: 6,
        paddingBottom: 6,
        minHeight: 50,
        minWidth: 44,
        border: "none",
        borderRadius: 12,
        background: isScan ? "color-mix(in srgb, var(--action) 8%, transparent)" : "transparent",
        cursor: "pointer",
        color,
        transition: "color 120ms ease, background 120ms ease",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {icon}
      <span style={{ fontSize: "var(--text-2xs)", fontWeight: isScan || active ? 600 : 400, lineHeight: 1 }}>
        {label}
      </span>
    </button>
  );
}

export function NativeTabBar({ onMorePress, onScanPress }: Props) {
  const [location, navigate] = useLocation();

  const tabs: TabDef[] = [
    { id: "today",     href: "/home",       label: t.nav.today,     icon: <Home size={22} /> },
    { id: "equipment", href: "/my-equipment", label: t.nav.equipment, icon: <Package size={22} /> },
    { id: "scan",      label: t.nav.equipmentScan, icon: <QrCode size={22} />, isScan: true },
    { id: "emergency", href: "/code-blue",  label: t.nav.emergency, icon: <Activity size={22} /> },
    { id: "more",      label: t.nav.menu,   icon: <AlignJustify size={22} />, isMore: true },
  ];

  return (
    <nav
      aria-label={t.nav.tabBar}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: `6px 8px max(env(safe-area-inset-bottom), 22px)`,
        background: "var(--bar-bg)",
        backdropFilter: "blur(var(--bar-blur))",
        WebkitBackdropFilter: "blur(var(--bar-blur))",
        borderTop: "0.5px solid var(--hairline)",
        flexShrink: 0,
      }}
    >
      {tabs.map((tab) => (
        <TabButton
          key={tab.id}
          label={tab.label}
          icon={tab.icon}
          isScan={tab.isScan}
          active={!!tab.href && isTabActive(location, tab.href)}
          onClick={() => {
            if (tab.isMore) { onMorePress(); return; }
            if (tab.isScan) { onScanPress ? onScanPress() : navigate("/scan"); return; }
            if (tab.href) navigate(tab.href);
          }}
        />
      ))}
    </nav>
  );
}
