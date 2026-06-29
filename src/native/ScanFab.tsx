import { useLocation } from "wouter";
import { QrCode } from "lucide-react";
import { t } from "@/lib/i18n";

export function ScanFab() {
  const [, navigate] = useLocation();

  return (
    <button
      type="button"
      aria-label={t.nav.equipmentScan}
      onClick={() => navigate("/scan")}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        border: "none",
        background: "transparent",
        cursor: "pointer",
        WebkitTapHighlightColor: "transparent",
        paddingInline: 8,
        paddingTop: 4,
        marginTop: -22,
      }}
    >
      <span
        style={{
          width: 60,
          height: 60,
          borderRadius: 16,
          background: "hsl(var(--primary))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 6px 22px -6px hsl(var(--primary) / 0.55)",
          flexShrink: 0,
        }}
      >
        <QrCode size={28} color="white" strokeWidth={2} />
      </span>
      <span
        style={{
          fontSize: "var(--text-2xs)",
          fontWeight: 600,
          color: "hsl(var(--muted-foreground))",
          lineHeight: 1,
        }}
      >
        {t.nav.equipmentScan}
      </span>
    </button>
  );
}
