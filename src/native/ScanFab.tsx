import { useLocation } from "wouter";
import { Scan } from "lucide-react";
import { t } from "@/lib/i18n";

export function ScanFab() {
  const [location, navigate] = useLocation();

  const openScanner = () => {
    const [pathname, search = ""] = location.split("?");
    if (pathname === "/equipment") {
      const params = new URLSearchParams(search);
      params.set("scan", "1");
      navigate(`/equipment?${params.toString()}`);
      return;
    }
    navigate("/equipment?scan=1");
  };

  return (
    <button
      type="button"
      aria-label={t.nav.equipmentScan}
      onClick={openScanner}
      className="vt-scan-fab"
      style={{
        width: 52,
        height: 52,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "none",
        cursor: "pointer",
        flexShrink: 0,
        marginTop: -20,
        position: "relative",
        zIndex: 1,
      }}
    >
      <Scan size={24} strokeWidth={2} />
    </button>
  );
}
