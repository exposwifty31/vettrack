import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { User, Globe, Info, LogOut } from "lucide-react";
import { SettingRow } from "./SettingRow";
import { t, setStoredLocale, getCurrentLocale } from "@/lib/i18n";

type Props = {
  open: boolean;
  onClose: () => void;
};

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
          background: "var(--background)",
          zIndex: 50,
          paddingBottom: "calc(16px + env(safe-area-inset-bottom))",
          boxShadow: "0 -12px 40px rgba(0,0,0,0.18)",
          outline: "none",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 12, paddingBottom: 4 }}>
          <div
            aria-hidden
            style={{ width: 32, height: 4, borderRadius: 2, background: "var(--muted)" }}
          />
        </div>

        <div style={{ paddingInline: 16, paddingTop: 12, paddingBottom: 4 }}>
          <p style={{ fontSize: "var(--text-2xs)", fontWeight: 600, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.08em", margin: 0 }}>
            {t.more.account}
          </p>
        </div>
        <SettingRow
          icon={<User size={20} />}
          label={t.more.profile}
          onClick={() => { navigate("/settings"); onClose(); }}
        />
        <SettingRow
          icon={<Globe size={20} />}
          label={t.more.language}
          value={getCurrentLocale().toUpperCase()}
          onClick={toggleLocale}
        />

        <div style={{ height: 1, background: "var(--border)", marginBlock: 8, marginInline: 20 }} />

        <div style={{ paddingInline: 16, paddingTop: 4, paddingBottom: 4 }}>
          <p style={{ fontSize: "var(--text-2xs)", fontWeight: 600, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.08em", margin: 0 }}>
            {t.more.clinic}
          </p>
        </div>
        <SettingRow
          icon={<Info size={20} />}
          label={t.more.about}
          onClick={() => { navigate("/settings"); onClose(); }}
        />

        <div style={{ height: 1, background: "var(--border)", marginBlock: 8, marginInline: 20 }} />

        <div style={{ paddingInline: 16, paddingTop: 4, paddingBottom: 4 }}>
          <p style={{ fontSize: "var(--text-2xs)", fontWeight: 600, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.08em", margin: 0 }}>
            {t.more.session}
          </p>
        </div>
        <SettingRow
          icon={<LogOut size={20} />}
          label={t.more.endShift}
          destructive
          onClick={() => { navigate("/handoff"); onClose(); }}
        />
      </div>
    </>
  );
}
