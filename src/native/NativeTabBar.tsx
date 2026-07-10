import { useLocation } from "wouter";
import { Home, Package, Activity, AlignJustify, QrCode, User } from "lucide-react";
import { t } from "@/lib/i18n";
import { useScanAffordance } from "@/lib/scan-affordance";
import { useExperience } from "@/hooks/use-experience";
import { isCustodyOnly } from "@/lib/roles/experience-model";

type TabDef = {
  id: string;
  href: string;
  label: string;
  icon: React.ReactNode;
};

type Props = {
  onMorePress: () => void;
};

export function isTabActive(location: string, href: string): boolean {
  const path = href.split("?")[0];
  if (path === "/home") return location === "/home" || location === "/";
  // Equipment tab covers the browse list and its detail/scan sub-routes only.
  // `/my-equipment` is NOT matched here: for custody-only users it has its own
  // dedicated "Mine" tab (matching both would light two tabs at once), and for
  // everyone else it lives in the MoreSheet/sidebar where `isNavItemActive`
  // handles its active state.
  if (path === "/equipment") {
    if (location.startsWith("/equipment/tasks")) return false;
    return location.startsWith("/equipment");
  }
  return location.startsWith(path);
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
        paddingTop: 6,
        paddingBottom: 6,
        minHeight: 50,
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
 * Sole tab-bar owner for the native phone shell.
 * Renders: Today · Equipment · [Scan tab] · Emergency · Menu.
 *
 * The scan affordance is gated by the single platform helper: on native phone
 * it is a flat scan TAB (never a raised FAB); on web it renders nothing. The
 * iPad FAB lives in NativeTabSidebar, not here.
 */
export function NativeTabBar({ onMorePress }: Props) {
  const [location, navigate] = useLocation();
  const affordance = useScanAffordance();
  const experience = useExperience();
  const custodyOnly = isCustodyOnly(experience);

  const leftTabs: TabDef[] = [
    { id: "today", href: "/home", label: t.nav.today, icon: <Home size={22} /> },
    { id: "equipment", href: "/equipment", label: t.nav.equipment, icon: <Package size={22} /> },
  ];

  // Custody-only (student): no Emergency tab — swap in My Equipment so the bar
  // stays entirely within the custody scope (Home · Equipment · Scan · Mine · Menu).
  const rightTabs: TabDef[] = custodyOnly
    ? [{ id: "mine", href: "/my-equipment", label: t.nav.mine, icon: <User size={22} /> }]
    : [{ id: "emergency", href: "/code-blue", label: t.nav.emergency, icon: <Activity size={22} /> }];

  return (
    <nav
      aria-label={t.nav.tabBar}
      style={{
        display: "flex",
        alignItems: "center",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
        backgroundColor: "hsl(var(--background) / 0.96)",
        borderTop: "0.5px solid hsl(var(--border))",
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

      {affordance === "tab" && (
        <TabButton
          label={t.nav.equipmentScan}
          icon={<QrCode size={22} />}
          active={isTabActive(location, "/scan")}
          onClick={() => navigate("/scan")}
        />
      )}

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
        label={t.nav.menu}
        icon={<AlignJustify size={22} />}
        active={false}
        onClick={onMorePress}
      />
    </nav>
  );
}
