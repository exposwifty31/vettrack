import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { SettingRow } from "./SettingRow";
import { t } from "@/lib/i18n";
import { useExperience } from "@/hooks/use-experience";
import { visibleNavSections } from "@/lib/roles/experience-model";
import { useIsTabletViewport } from "@/lib/use-tablet-viewport";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useActiveShift } from "@/hooks/use-active-shift";
import { getNativeNavSections, type NativeNavItem } from "@/lib/routes/native-nav-model";
import { ReportIssueDialog } from "@/components/report-issue-dialog";

type Props = {
  open: boolean;
  onClose: () => void;
};

function SectionHeader({ label }: { label: string }) {
  return (
    <div style={{ paddingInline: 16, paddingTop: 12, paddingBottom: 4 }}>
      <p style={{
        fontSize: "var(--text-2xs)",
        fontWeight: 600,
        color: "hsl(var(--muted-foreground))",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        margin: 0,
      }}>
        {label}
      </p>
    </div>
  );
}

function Divider() {
  return (
    <div style={{ height: 1, background: "hsl(var(--border))", marginBlock: 8, marginInline: 20 }} />
  );
}

export function MoreSheet({ open, onClose }: Props) {
  const [, navigate] = useLocation();
  const experience = useExperience();
  const dialogRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef<number | null>(null);
  const isTablet = useIsTabletViewport();
  const { hasActiveShift, isLoading: shiftLoading } = useActiveShift();
  const [reportBugOpen, setReportBugOpen] = useState(false);

  useFocusTrap({ active: open, containerRef: dialogRef, onEscape: onClose });

  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  function handleBackdropClick() { onClose(); }
  function handleDragStart(e: React.TouchEvent) { startYRef.current = e.touches[0]?.clientY ?? null; }
  function handleDragEnd(e: React.TouchEvent) {
    if (startYRef.current === null) return;
    const dy = (e.changedTouches[0]?.clientY ?? 0) - startYRef.current;
    if (dy > 60) onClose();
    startYRef.current = null;
  }

  function go(href: string) { navigate(href); onClose(); }

  function handleSelect(item: NativeNavItem) {
    if (item.action === "report-issue") {
      onClose();
      setReportBugOpen(true);
      return;
    }
    if (item.href) go(item.href);
  }

  // Render even when the sheet is closed so the report-bug dialog — opened from a
  // row that also closes the sheet — stays mounted while it is visible.
  if (!open && !reportBugOpen) return null;

  // Phone drawer: the bottom tab bar already carries `inPhoneTabBar` items
  // (Today / Equipment / Scan / Emergency), so hide them here to avoid duplicates.
  // Shared admin+custody visibility first, then the tab-bar filter on top.
  const sections = visibleNavSections(
    getNativeNavSections({ hasActiveShift: shiftLoading || hasActiveShift }),
    experience,
  )
    .map((section) => ({ ...section, items: section.items.filter((item) => !item.inPhoneTabBar) }))
    .filter((section) => section.items.length > 0);

  return (
    <>
      {open && (
        <>
      <div
        aria-hidden
        onClick={handleBackdropClick}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 49 }}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t.more.title}
        tabIndex={-1}
        onTouchStart={isTablet ? undefined : handleDragStart}
        onTouchEnd={isTablet ? undefined : handleDragEnd}
        style={isTablet ? {
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 380,
          maxWidth: "90vw",
          maxHeight: "85vh",
          borderRadius: 20,
          background: "hsl(var(--background))",
          zIndex: 50,
          paddingBottom: 16,
          boxShadow: "0 24px 60px rgba(0,0,0,0.25)",
          outline: "none",
          overflowY: "auto",
          animation: "fadeIn 180ms ease both",
        } : {
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          borderRadius: "28px 28px 0 0",
          background: "hsl(var(--background))",
          zIndex: 50,
          paddingBottom: "calc(16px + env(safe-area-inset-bottom))",
          boxShadow: "0 -12px 40px rgba(0,0,0,0.18)",
          outline: "none",
          maxHeight: "85vh",
          overflowY: "auto",
          animation: "sheet-slide-up 280ms cubic-bezier(0.32, 0.72, 0, 1) both",
        }}
      >
        {/* Drag handle */}
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 12, paddingBottom: 4 }}>
          <div aria-hidden style={{ width: 32, height: 4, borderRadius: 2, background: "hsl(var(--muted))" }} />
        </div>

        {sections.map((section, idx) => (
          <div key={section.id}>
            {idx > 0 && <Divider />}
            <SectionHeader label={section.label} />
            {section.items.map((item) => {
              const Icon = item.Icon;
              return (
                <SettingRow
                  key={item.id}
                  icon={<Icon size={20} />}
                  label={item.label}
                  destructive={item.destructive}
                  onClick={() => handleSelect(item)}
                />
              );
            })}
          </div>
        ))}
      </div>
        </>
      )}
      {reportBugOpen && <ReportIssueDialog open onOpenChange={setReportBugOpen} />}
    </>
  );
}
