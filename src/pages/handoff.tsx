import { useLocation } from "wouter";
import { t } from "@/lib/i18n";
import { ShiftSummarySheet } from "@/components/shift-summary-sheet";

export default function HandoffPage() {
  const [, navigate] = useLocation();

  const handleClose = () => {
    if (typeof window !== "undefined" && window.history.length > 1) window.history.back();
    else navigate("/home");
  };

  return <ShiftSummarySheet open={true} onClose={handleClose} />;
}
