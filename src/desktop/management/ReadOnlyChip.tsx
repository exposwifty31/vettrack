import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { t } from "@/lib/i18n";

/**
 * Persistent "read only" chip — mandatory on observe-only console surfaces
 * (e.g. Ops Health, per the frozen-surface doctrine). Functional glyph (lock)
 * does not mirror in RTL.
 */
export function ReadOnlyChip() {
  return (
    <Badge variant="secondary" className="gap-1">
      <Lock className="h-3 w-3" aria-hidden="true" />
      {t.console.readOnly}
    </Badge>
  );
}
