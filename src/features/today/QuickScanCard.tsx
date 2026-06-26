import { useLocation } from "wouter";
import { Scan } from "lucide-react";
import { t } from "@/lib/i18n";

export function QuickScanCard() {
  const [, navigate] = useLocation();

  return (
    <button
      type="button"
      onClick={() => navigate("/equipment?scan=1")}
      style={{
        width: "100%",
        minHeight: 56,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "12px 16px",
        borderRadius: 14,
        background: "hsl(var(--card))",
        border: "none",
        cursor: "pointer",
        WebkitTapHighlightColor: "transparent",
        boxShadow: "none",
        transition: "transform 120ms ease",
        textAlign: "start",
      }}
      onPointerDown={(e) => (e.currentTarget.style.transform = "scale(0.98)")}
      onPointerUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
      onPointerLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
    >
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 700, color: "hsl(var(--foreground))" }}>
          {t.home.scan.label}
        </span>
        <span style={{ display: "block", fontSize: "var(--text-xs)", color: "hsl(var(--muted-foreground))", marginTop: 2 }}>
          {t.home.scan.subtitle}
        </span>
      </span>
      <span
        style={{
          flexShrink: 0,
          width: 36,
          height: 36,
          borderRadius: 10,
          background: "hsl(var(--muted))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "hsl(var(--foreground))",
        }}
      >
        <Scan size={20} aria-hidden />
      </span>
    </button>
  );
}
