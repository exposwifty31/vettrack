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
        minHeight: 64,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "14px 16px",
        borderRadius: 16,
        background: "linear-gradient(135deg, var(--brand) 0%, var(--brand-deep) 100%)",
        border: "none",
        cursor: "pointer",
        WebkitTapHighlightColor: "transparent",
        boxShadow: "0 8px 20px -8px var(--brand-shadow)",
        transition: "transform 120ms ease",
        textAlign: "start",
      }}
      onPointerDown={(e) => (e.currentTarget.style.transform = "scale(0.98)")}
      onPointerUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
      onPointerLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
    >
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 700, color: "#fff" }}>
          {t.home.scan.label}
        </span>
        <span style={{ display: "block", fontSize: "var(--text-xs)", color: "rgba(255,255,255,0.72)", marginTop: 2 }}>
          {t.home.scan.subtitle}
        </span>
      </span>
      <span
        style={{
          flexShrink: 0,
          width: 40,
          height: 40,
          borderRadius: 12,
          background: "rgba(255,255,255,0.15)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
        }}
      >
        <Scan size={20} aria-hidden />
      </span>
    </button>
  );
}
