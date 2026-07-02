import { useLocation } from "wouter";
import { Scan } from "lucide-react";
import { t } from "@/lib/i18n";
import { useScanAffordance } from "@/lib/scan-affordance";

export function QuickScanCard() {
  const [, navigate] = useLocation();
  const affordance = useScanAffordance();

  // Redundant wherever a persistent scan affordance exists (the flat scan tab on
  // iPhone) and disallowed on web. Only the iPad "fab" layout keeps this CTA.
  if (affordance !== "fab") return null;

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
        background: "var(--brand)",
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
          width: 36,
          height: 36,
          borderRadius: 10,
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
