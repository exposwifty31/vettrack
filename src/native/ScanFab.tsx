import { useLocation } from "wouter";
import { QrCode } from "lucide-react";
import { t } from "@/lib/i18n";
import { useScanAffordance } from "@/lib/scan-affordance";

/**
 * Floating scan action button for the native tablet (iPad) layout, which uses a
 * sidebar and has no bottom tab bar. Self-gating: renders only when the single
 * scan-affordance helper resolves to "fab" (native tablet). On native phone the
 * scan affordance is a flat tab in NativeTabBar; on web it is nothing.
 */
export function ScanFab() {
  const [, navigate] = useLocation();
  const affordance = useScanAffordance();

  if (affordance !== "fab") return null;

  return (
    <button
      type="button"
      aria-label={t.nav.equipmentScan}
      onClick={() => navigate("/scan")}
      style={{
        position: "fixed",
        insetInlineEnd: 24,
        insetBlockEnd: "calc(env(safe-area-inset-bottom) + 24px)",
        zIndex: 40,
        width: 64,
        height: 64,
        borderRadius: 20,
        border: "none",
        background: "hsl(var(--primary))",
        color: "white",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        boxShadow: "0 8px 26px -6px hsl(var(--primary) / 0.55)",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <QrCode size={28} color="white" strokeWidth={2} aria-hidden />
    </button>
  );
}
