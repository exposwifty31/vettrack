import { ChevronLeft, ChevronRight, type LucideProps } from "lucide-react";
import { useDirection } from "@/hooks/useDirection";

/**
 * Chevron pointing in the reading-FORWARD direction for the active locale:
 * left in RTL (Hebrew), right in LTR. Use for "next" / drill-in affordances so
 * the arrow never contradicts the layout (fixes RTL forward/back inversion).
 */
export function ForwardChevron(props: LucideProps) {
  const dir = useDirection();
  const Icon = dir === "rtl" ? ChevronLeft : ChevronRight;
  return <Icon {...props} />;
}

/**
 * Chevron pointing in the reading-BACK direction: right in RTL, left in LTR.
 * Use for "previous" / collapse affordances and breadcrumb separators.
 */
export function BackChevron(props: LucideProps) {
  const dir = useDirection();
  const Icon = dir === "rtl" ? ChevronRight : ChevronLeft;
  return <Icon {...props} />;
}
