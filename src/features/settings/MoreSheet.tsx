import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import {
  LogOut, User,
  Bell, MapPin, LayoutGrid, Settings, Clock,
  Home, Package, ListTodo, ShieldCheck, ShoppingCart,
  TrendingUp, Monitor, Box, ShoppingBag,
} from "lucide-react";
import { SettingRow } from "./SettingRow";
import { t } from "@/lib/i18n";
import { useAuth } from "@/hooks/use-auth";

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
  const { isAdmin } = useAuth();
  const dialogRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef<number | null>(null);

  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  function handleBackdropClick() { onClose(); }
  function handleKeyDown(e: React.KeyboardEvent) { if (e.key === "Escape") onClose(); }
  function handleDragStart(e: React.TouchEvent) { startYRef.current = e.touches[0]?.clientY ?? null; }
  function handleDragEnd(e: React.TouchEvent) {
    if (startYRef.current === null) return;
    const dy = (e.changedTouches[0]?.clientY ?? 0) - startYRef.current;
    if (dy > 60) onClose();
    startYRef.current = null;
  }

  function go(href: string) { navigate(href); onClose(); }

  if (!open) return null;

  return (
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
          maxHeight: "85vh",
          overflowY: "auto",
          animation: "sheet-slide-up 280ms cubic-bezier(0.32, 0.72, 0, 1) both",
        }}
      >
        {/* Drag handle */}
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 12, paddingBottom: 4 }}>
          <div aria-hidden style={{ width: 32, height: 4, borderRadius: 2, background: "hsl(var(--muted))" }} />
        </div>

        {/* Operations */}
        <div style={{ paddingInline: 16, paddingTop: 12, paddingBottom: 4 }}>
          <p style={{ fontSize: "var(--text-2xs)", fontWeight: 600, color: "hsl(var(--muted-foreground))", textTransform: "uppercase", letterSpacing: "0.08em", margin: 0 }}>
            {t.nav.operationsSection}
          </p>
        </div>
        <SettingRow icon={<Home         size={20} />} label={t.nav.today}             onClick={() => go("/home")} />
        <SettingRow icon={<Package      size={20} />} label={t.nav.equipment}         onClick={() => go("/equipment")} />
        <SettingRow icon={<LayoutGrid   size={20} />} label={t.nav.board}             onClick={() => go("/equipment/board")} />
        <SettingRow icon={<ListTodo     size={20} />} label={t.nav.equipmentTasks}    onClick={() => go("/equipment/tasks")} />
        <SettingRow icon={<ShieldCheck  size={20} />} label={t.nav.criticalKitCheck}  onClick={() => go("/crash-cart")} />
        <SettingRow icon={<MapPin       size={20} />} label={t.nav.rooms}             onClick={() => go("/rooms")} />
        <SettingRow icon={<User         size={20} />} label={t.nav.mine}              onClick={() => go("/my-equipment")} />
        <SettingRow icon={<Bell         size={20} />} label={t.nav.alerts}            onClick={() => go("/alerts")} />
        <SettingRow icon={<ShoppingCart size={20} />} label={t.nav.inventory}         onClick={() => go("/inventory")} />

        <div style={{ height: 1, background: "hsl(var(--border))", marginBlock: 8, marginInline: 20 }} />

        {/* Management — shown only for admins */}
        {isAdmin && (
          <>
            <div style={{ paddingInline: 16, paddingTop: 4, paddingBottom: 4 }}>
              <p style={{ fontSize: "var(--text-2xs)", fontWeight: 600, color: "hsl(var(--muted-foreground))", textTransform: "uppercase", letterSpacing: "0.08em", margin: 0 }}>
                {t.nav.managementSection}
              </p>
            </div>
            <SettingRow icon={<TrendingUp  size={20} />} label={t.nav.analytics}      onClick={() => go("/analytics")} />
            <SettingRow icon={<Monitor     size={20} />} label={t.nav.dashboard}       onClick={() => go("/dashboard")} />
            <SettingRow icon={<Box         size={20} />} label={t.nav.inventoryItems}  onClick={() => go("/inventory-items")} />
            <SettingRow icon={<ShoppingBag size={20} />} label={t.nav.procurement}     onClick={() => go("/procurement")} />
            <SettingRow icon={<Settings    size={20} />} label={t.nav.admin}           onClick={() => go("/admin")} />
            <SettingRow icon={<Clock       size={20} />} label={t.nav.adminShifts}     onClick={() => go("/admin/shifts")} />
            <div style={{ height: 1, background: "hsl(var(--border))", marginBlock: 8, marginInline: 20 }} />
          </>
        )}

        {/* Account */}
        <div style={{ paddingInline: 16, paddingTop: 4, paddingBottom: 4 }}>
          <p style={{ fontSize: "var(--text-2xs)", fontWeight: 600, color: "hsl(var(--muted-foreground))", textTransform: "uppercase", letterSpacing: "0.08em", margin: 0 }}>
            {t.more.account}
          </p>
        </div>
        <SettingRow icon={<Settings size={20} />} label={t.more.settings} onClick={() => go("/settings")} />

        <div style={{ height: 1, background: "hsl(var(--border))", marginBlock: 8, marginInline: 20 }} />

        {/* Session */}
        <div style={{ paddingInline: 16, paddingTop: 4, paddingBottom: 4 }}>
          <p style={{ fontSize: "var(--text-2xs)", fontWeight: 600, color: "hsl(var(--muted-foreground))", textTransform: "uppercase", letterSpacing: "0.08em", margin: 0 }}>
            {t.more.session}
          </p>
        </div>
        <SettingRow icon={<LogOut size={20} />} label={t.more.endShift} destructive onClick={() => go("/handoff")} />
      </div>
    </>
  );
}
