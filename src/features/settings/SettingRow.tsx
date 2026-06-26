import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

type Props = {
  icon?: ReactNode;
  label: string;
  value?: string;
  destructive?: boolean;
  onClick: () => void;
};

export function SettingRow({ icon, label, value, destructive = false, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: "100%",
        minHeight: 52,
        paddingInline: 20,
        background: "transparent",
        border: "none",
        cursor: "pointer",
        WebkitTapHighlightColor: "transparent",
        textAlign: "start",
      }}
      onPointerDown={(e) => (e.currentTarget.style.background = "var(--muted)")}
      onPointerUp={(e) => (e.currentTarget.style.background = "transparent")}
      onPointerLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {icon && (
        <span style={{ width: 20, height: 20, color: "var(--muted-foreground)", flexShrink: 0, display: "flex", alignItems: "center" }}>
          {icon}
        </span>
      )}
      <span
        style={{
          flex: 1,
          fontSize: "var(--text-sm)",
          fontWeight: 500,
          color: destructive ? "var(--destructive)" : "var(--foreground)",
        }}
      >
        {label}
      </span>
      {value && (
        <span style={{ fontSize: "var(--text-xs)", color: "var(--muted-foreground)", marginInlineEnd: 4 }}>
          {value}
        </span>
      )}
      <ChevronRight
        size={16}
        aria-hidden
        style={{ color: "var(--muted-foreground)", flexShrink: 0 }}
      />
    </button>
  );
}
