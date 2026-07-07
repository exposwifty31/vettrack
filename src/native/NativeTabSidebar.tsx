import { useState } from "react";
import { useLocation } from "wouter";
import { t } from "@/lib/i18n";
import { useExperience } from "@/hooks/use-experience";
import { filterAdminNav } from "@/lib/roles/experience-model";
import { useActiveShift } from "@/hooks/use-active-shift";
import { ReportIssueDialog } from "@/components/report-issue-dialog";
import {
  getNativeNavSections,
  isNavItemActive,
  type NativeNavItem,
} from "@/lib/routes/native-nav-model";

function SidebarButton({
  label,
  icon,
  active,
  destructive,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  destructive?: boolean;
  onClick: () => void;
}) {
  const color = destructive
    ? "hsl(var(--destructive))"
    : active
      ? "hsl(var(--primary))"
      : "hsl(var(--muted-foreground))";
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
        color,
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

function SidebarSectionHeader({ label }: { label: string }) {
  return (
    <p
      style={{
        paddingInline: 16,
        paddingTop: 14,
        paddingBottom: 4,
        margin: 0,
        fontSize: "var(--text-2xs)",
        fontWeight: 600,
        color: "hsl(var(--muted-foreground))",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
      }}
    >
      {label}
    </p>
  );
}

/**
 * Vertical sidebar navigation for tablet (iPad) layout — the sole nav surface on
 * tablet. Replaces NativeTabBar on wide screens and carries the full grouped nav
 * (from `getNativeNavSections`), so there is no overflow "Menu" drawer and no
 * floating scan FAB on iPad; Scan is a first-class nav item.
 */
export function NativeTabSidebar() {
  const [location, navigate] = useLocation();
  const experience = useExperience();
  const { hasActiveShift, isLoading: shiftLoading } = useActiveShift();
  const [reportBugOpen, setReportBugOpen] = useState(false);

  const sections = filterAdminNav(
    getNativeNavSections({ hasActiveShift: shiftLoading || hasActiveShift }),
    experience,
  );
  const allHrefs = sections.flatMap((section) =>
    section.items
      .map((item: NativeNavItem) => item.href)
      .filter((href): href is string => Boolean(href)),
  );

  function handleSelect(item: NativeNavItem) {
    if (item.action === "report-issue") {
      setReportBugOpen(true);
      return;
    }
    if (item.href) navigate(item.href);
  }

  return (
    <>
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

      {sections.map((section) => (
        <div key={section.id}>
          <SidebarSectionHeader label={section.label} />
          {section.items.map((item) => {
            const Icon = item.Icon;
            return (
              <SidebarButton
                key={item.id}
                label={item.label}
                icon={<Icon size={20} />}
                active={item.href ? isNavItemActive(location, item.href, allHrefs) : false}
                destructive={item.destructive}
                onClick={() => handleSelect(item)}
              />
            );
          })}
        </div>
      ))}
    </nav>
    {reportBugOpen && <ReportIssueDialog open onOpenChange={setReportBugOpen} />}
    </>
  );
}
