import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import {
  Home, Package, Monitor, ClipboardList, Activity, Map,
  User, Bell, Archive, BarChart2, LayoutDashboard, List,
  ShoppingCart, Shield, Calendar, Sparkles, BookOpen,
  FileText, Clock, Siren, Settings, Bug, Globe, LogOut,
} from "lucide-react";
import { SettingRow } from "./SettingRow";
import { t, setStoredLocale, getCurrentLocale } from "@/lib/i18n";

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
  const dialogRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef<number | null>(null);

  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  function handleBackdropClick() {
    onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }

  function handleDragStart(e: React.TouchEvent) {
    startYRef.current = e.touches[0]?.clientY ?? null;
  }

  function handleDragEnd(e: React.TouchEvent) {
    if (startYRef.current === null) return;
    const dy = (e.changedTouches[0]?.clientY ?? 0) - startYRef.current;
    if (dy > 60) onClose();
    startYRef.current = null;
  }

  function go(path: string) {
    navigate(path);
    onClose();
  }

  function toggleLocale() {
    const next = getCurrentLocale() === "he" ? "en" : "he";
    setStoredLocale(next);
  }

  if (!open) return null;

  return (
    <>
      <div
        aria-hidden
        onClick={handleBackdropClick}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          zIndex: 49,
        }}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t.more.title}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        onTouchStart={handleDragStart}
        onTouchEnd={handleDragEnd}
        style={{
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
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 12, paddingBottom: 4, flexShrink: 0 }}>
          <div
            aria-hidden
            style={{ width: 32, height: 4, borderRadius: 2, background: "hsl(var(--muted))" }}
          />
        </div>

        <div style={{ paddingInline: 20, paddingTop: 4, paddingBottom: 8, flexShrink: 0 }}>
          <p style={{ fontSize: "var(--text-sm)", fontWeight: 700, color: "hsl(var(--foreground))", margin: 0 }}>
            {t.more.title}
          </p>
        </div>

        <div style={{ overflowY: "auto", flex: 1 }}>
          <SectionHeader label={t.more.sectionOps} />
          <SettingRow icon={<Home size={20} />} label={t.nav.today} onClick={() => go("/home")} />
          <SettingRow icon={<Package size={20} />} label={t.nav.equipment} onClick={() => go("/equipment")} />
          <SettingRow icon={<Monitor size={20} />} label={t.nav.board} onClick={() => go("/equipment/board")} />
          <SettingRow icon={<ClipboardList size={20} />} label={t.nav.equipmentTasks} onClick={() => go("/equipment/tasks")} />
          <SettingRow icon={<Activity size={20} />} label={t.nav.crashCart} onClick={() => go("/crash-cart")} />
          <SettingRow icon={<Map size={20} />} label={t.nav.rooms} onClick={() => go("/rooms")} />
          <SettingRow icon={<User size={20} />} label={t.nav.myEquipment} onClick={() => go("/my-equipment")} />
          <SettingRow icon={<Bell size={20} />} label={t.nav.alerts} onClick={() => go("/alerts")} />
          <SettingRow icon={<Archive size={20} />} label={t.nav.inventory} onClick={() => go("/inventory")} />

          <Divider />

          <SectionHeader label={t.more.sectionAdmin} />
          <SettingRow icon={<BarChart2 size={20} />} label={t.nav.analytics} onClick={() => go("/analytics")} />
          <SettingRow icon={<LayoutDashboard size={20} />} label={t.nav.dashboard} onClick={() => go("/dashboard")} />
          <SettingRow icon={<List size={20} />} label={t.nav.inventoryItems} onClick={() => go("/inventory-items")} />
          <SettingRow icon={<ShoppingCart size={20} />} label={t.nav.procurement} onClick={() => go("/procurement")} />
          <SettingRow icon={<Shield size={20} />} label={t.nav.admin} onClick={() => go("/admin")} />
          <SettingRow icon={<Calendar size={20} />} label={t.nav.adminShifts} onClick={() => go("/admin/shifts")} />

          <Divider />

          <SectionHeader label={t.more.sectionRoutine} />
          <SettingRow icon={<Sparkles size={20} />} label={t.nav.whatsNew} onClick={() => go("/whats-new")} />
          <SettingRow icon={<BookOpen size={20} />} label={t.nav.quickGuide} onClick={() => go("/help")} />
          <SettingRow icon={<FileText size={20} />} label={t.nav.auditLog} onClick={() => go("/audit-log")} />
          <SettingRow icon={<Clock size={20} />} label={t.nav.emergencyHistory} onClick={() => go("/admin/code-blue-history")} />
          <SettingRow icon={<Siren size={20} />} label={t.nav.emergency} onClick={() => go("/code-blue")} />
          <SettingRow icon={<Settings size={20} />} label={t.nav.settings} onClick={() => go("/settings")} />
          <SettingRow icon={<Bug size={20} />} label={t.nav.reportBug} onClick={() => go("/support")} />

          <Divider />

          <SettingRow
            icon={<Globe size={20} />}
            label={t.more.language}
            value={getCurrentLocale().toUpperCase()}
            onClick={toggleLocale}
          />
          <SettingRow
            icon={<LogOut size={20} />}
            label={t.more.endShift}
            destructive
            onClick={() => go("/handoff")}
          />
        </div>
      </div>
    </>
  );
}
