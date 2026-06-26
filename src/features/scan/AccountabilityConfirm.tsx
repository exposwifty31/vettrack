import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";

type Props = {
  equipmentName: string;
  onDismiss: () => void;
};

export function AccountabilityConfirm({ equipmentName, onDismiss }: Props) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const id = setTimeout(() => {
      setVisible(false);
      onDismiss();
    }, 3000);
    return () => clearTimeout(id);
  }, [onDismiss]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: "calc(80px + env(safe-area-inset-bottom))",
        left: 16,
        right: 16,
        zIndex: 50,
        background: "var(--action)",
        color: "#fff",
        borderRadius: 12,
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        boxShadow: "0 4px 24px rgba(0,0,0,0.18)",
        animation: "vt-slide-up 200ms ease",
      }}
    >
      <span style={{ fontSize: 18 }}>✓</span>
      <span style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>
        {equipmentName} — {t.scan.checkedInTo}
      </span>
    </div>
  );
}
