import { useLocation } from "wouter";
import { Home, Package, Activity, AlignJustify, QrCode } from "lucide-react";
import { t } from "@/lib/i18n";

type Props = {
  onMorePress: () => void;
};

type NavItem = {
  id: string;
  href: string;
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
};

export function isTabActive(location: string, href: string): boolean {
  if (href === "/home") return location === "/home" || location === "/";
  return location.startsWith(href.split("?")[0]);
}

function SidebarButton({
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
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: "100%",
        minHeight: 52,
        paddingInline: 16,
        border: "none",
        background: active ? "hsl(var(--primary) / 0.1)" : "transparent",
        borderRadius: 12,
        cursor: "pointer",
        color: active ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
        transition: "background 150ms ease, color 150ms ease",
        WebkitTapHighlightColor: "transparent",
        fontWeight: active ? 600 : 400,
        fontSize: "var(--text-sm)",
        textAlign: "start",
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

/**
 * Vertical sidebar navigation for tablet (iPad) layout.
 * Replaces NativeTabBar on wide screens.
 */
export function NativeTabSidebar({ onMorePress }: Props) {
  const [location, navigate] = useLocation();

  const navItems: NavItem[] = [
    { id: "today",     href: "/home",      label: t.nav.today,     icon: <Home size={20} /> },
    { id: "equipment", href: "/my-equipment", label: t.nav.equipment, icon: <Package size={20} /> },
    { id: "scan",      href: "/scan",      label: t.nav.equipmentScan, icon: <QrCode size={20} /> },
    { id: "emergency", href: "/code-blue", label: t.nav.emergency, icon: <Activity size={20} /> },
  ];

  return (
    <nav
      aria-label={t.nav.tabBar}
      style={{
        width: 220,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        padding: "12px 8px",
        gap: 2,
        background: "hsl(var(--background) / 0.96)",
        borderInlineEnd: "0.5px solid hsl(var(--border))",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        overflowY: "auto",
      }}
    >
      {/* Wordmark */}
      <div
        dir="ltr"
        style={{
          paddingInline: 16,
          paddingBlock: 10,
          fontWeight: 700,
          fontSize: 18,
          letterSpacing: "-0.02em",
          color: "hsl(var(--foreground))",
          userSelect: "none",
          marginBottom: 8,
        }}
      >
        Vet<span style={{ color: "hsl(var(--primary))" }}>Track</span>
      </div>

      {navItems.map((item) => (
        <SidebarButton
          key={item.id}
          label={item.label}
          icon={item.icon}
          active={isTabActive(location, item.href)}
          onClick={item.onClick ?? (() => navigate(item.href))}
        />
      ))}

      <div style={{ flex: 1 }} />

      <SidebarButton
        label={t.nav.menu}
        icon={<AlignJustify size={20} />}
        active={false}
        onClick={onMorePress}
      />
    </nav>
  );
}
