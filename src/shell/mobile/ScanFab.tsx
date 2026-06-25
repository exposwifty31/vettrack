import { useLocation } from "wouter";
import { Scan } from "lucide-react";
import { t } from "@/lib/i18n";

export function ScanFab() {
  const [, navigate] = useLocation();
  return (
    <button
      type="button"
      aria-label={t.nav.equipmentScan}
      onClick={() => navigate("/equipment?scan=1")}
      className="vt-scan-fab"
      style={{
        width: 58,
        height: 58,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "none",
        cursor: "pointer",
        flexShrink: 0,
        marginTop: -30,
        position: "relative",
        zIndex: 1,
      }}
    >
      <Scan size={24} strokeWidth={2} />
    </button>
  );
}
