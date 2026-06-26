import { useLocation } from "wouter";
import { Home, Package, Bell, AlignJustify } from "lucide-react";
import { t } from "@/lib/i18n";
import { ScanFab } from "./ScanFab";

type TabDef = {
  id: string;
  href: string;
  label: string;
  icon: React.ReactNode;
};

type Props = {
  onMorePress: () => void;
};

function isTabActive(location: string, href: string): boolean {
  if (href === "/home") return location === "/home" || location === "/";
  return location.startsWith(href.split("?")[0]);
}

function TabButton({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
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
        gap: 2,
        paddingTop: 10,
        paddingBottom: 10,
        minHeight: 56,
        minWidth: 0,
        border: "none",
        background: "transparent",
        cursor: "pointer",
        color: active ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
        transition: "color 150ms ease",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {icon}
      <span
        style={{
          fontSize: "var(--text-2xs)",
          fontWeight: active ? 600 : 400,
          lineHeight: 1,
        }}
      >
        {label}
      </span>
    </button>
  );
}

/**
 * Sole tab-bar owner for the native shell.
 * Renders: Today · Equipment · [ScanFab] · Alerts · More.
 */
export function NativeTabBar({ onMorePress }: Props) {
  const [location, navigate] = useLocation();

  const leftTabs: TabDef[] = [
    { id: "today", href: "/home", label: t.nav.today, icon: <Home size={22} /> },
    { id: "equipment", href: "/equipment", label: t.nav.equipment, icon: <Package size={22} /> },
  ];

  const rightTabs: TabDef[] = [
    { id: "alerts", href: "/alerts", label: t.nav.alerts, icon: <Bell size={22} /> },
  ];

  return (
    <nav
      aria-label={t.nav.tabBar}
      style={{
        display: "flex",
        alignItems: "flex-end",
        paddingBottom: "env(safe-area-inset-bottom)",
        backgroundColor: "hsl(var(--background) / 0.96)",
        borderTop: "1px solid hsl(var(--border))",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        flexShrink: 0,
      }}
    >
      {leftTabs.map((tab) => (
        <TabButton
          key={tab.id}
          label={tab.label}
          icon={tab.icon}
          active={isTabActive(location, tab.href)}
          onClick={() => navigate(tab.href)}
        />
      ))}

      <div
        style={{ flex: 1, display: "flex", justifyContent: "center", paddingBottom: 4 }}
      >
        <ScanFab />
      </div>

      {rightTabs.map((tab) => (
        <TabButton
          key={tab.id}
          label={tab.label}
          icon={tab.icon}
          active={isTabActive(location, tab.href)}
          onClick={() => navigate(tab.href)}
        />
      ))}

      <TabButton
        label={t.nav.more}
        icon={<AlignJustify size={22} />}
        active={false}
        onClick={onMorePress}
      />
    </nav>
  );
}
