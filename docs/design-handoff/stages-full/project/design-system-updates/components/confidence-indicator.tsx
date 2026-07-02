// Lands at: src/components/equipment/confidence-indicator.tsx
// §20-D2 — companion to EquipmentTruthCard/DeployabilityBadge, not a replacement.
// Answers "how sure are we", where DeployabilityBadge answers "what state is it in".
import * as React from "react";
import { cn } from "@/lib/utils";
import {
  confidenceToStatusKind,
  type ConfidenceKind,
} from "@/core/entities/design-tokens";
import { t } from "@/lib/i18n";

const DOT_VAR: Record<ReturnType<typeof confidenceToStatusKind>, string> = {
  ok: "var(--status-ok-fg)",
  issue: "var(--status-issue-fg)",
  maintenance: "var(--status-maint-fg)",
  sterilized: "var(--status-steril-fg)",
  info: "var(--status-steril-fg)",
  neutral: "rgb(var(--ivory-text3))",
  stale: "var(--status-stale-fg)",
  unknown: "var(--status-unknown-fg)",
};

const LABEL: Record<ConfidenceKind, () => string> = {
  high: () => t.locationConfidence.high,
  medium: () => t.locationConfidence.medium,
  low: () => t.locationConfidence.low,
  unknown: () => t.locationConfidence.unknown,
};

export interface ConfidenceIndicatorProps
  extends React.HTMLAttributes<HTMLDivElement> {
  confidence: ConfidenceKind;
  /** One-line "why" — e.g. "Checked out by Dr. Lee · 12 min ago". Always show
   * the reasoning; never render a bare confidence label with no evidence
   * (Equipment Hero PRD: "never fake precision"). */
  reasoning: string;
  /** Badge-only (for list rows/headers) vs. full row (hero card). */
  compact?: boolean;
}

export function ConfidenceIndicator({
  confidence,
  reasoning,
  compact = false,
  className,
  ...props
}: ConfidenceIndicatorProps) {
  const dot = DOT_VAR[confidenceToStatusKind(confidence)];
  const label = LABEL[confidence]();

  if (compact) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-sm font-semibold",
          className,
        )}
        {...props}
      >
        <span
          aria-hidden="true"
          className="h-2 w-2 flex-shrink-0 rounded-full"
          style={{ background: dot }}
        />
        {label}
      </span>
    );
  }

  return (
    <div className={cn("flex flex-col gap-1", className)} {...props}>
      <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
        <span
          aria-hidden="true"
          className="h-2 w-2 flex-shrink-0 rounded-full"
          style={{ background: dot }}
        />
        {label}
      </span>
      <p className="text-sm text-muted-foreground">{reasoning}</p>
    </div>
  );
}
