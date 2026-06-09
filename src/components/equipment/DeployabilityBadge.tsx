import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { CustodyState, ReadinessState, UsageState } from "@/types";

interface DeployabilityBadgeProps {
  custodyState?: CustodyState | null;
  readinessState?: ReadinessState | null;
  usageState?: UsageState | null;
  fullDeployable?: boolean;
  compact?: boolean;
}

export function DeployabilityBadge({
  custodyState,
  readinessState,
  usageState,
  fullDeployable,
  compact = false,
}: DeployabilityBadgeProps) {
  if (custodyState == null) return null;

  let label: string;
  let colorClass: string;

  if (fullDeployable) {
    label = t.operationalState.fullDeployable;
    colorClass = "bg-[var(--status-ok-bg)] text-[var(--status-ok-fg)] border-[var(--status-ok-border)]";
  } else if (usageState === "in_use") {
    label = t.operationalState.usageState.in_use;
    colorClass = "bg-[var(--status-steril-bg)] text-[var(--status-steril-fg)] border-[var(--status-steril-border)]";
  } else if (usageState === "emergency_use") {
    label = t.operationalState.usageState.emergency_use;
    colorClass = "bg-[var(--status-issue-bg)] text-[var(--status-issue-fg)] border-[var(--status-issue-border)]";
  } else if (usageState === "procedure_bound") {
    label = t.operationalState.usageState.procedure_bound;
    colorClass = "bg-[var(--status-steril-bg)] text-[var(--status-steril-fg)] border-[var(--status-steril-border)]";
  } else if (usageState === "staged") {
    label = t.operationalState.usageState.staged;
    colorClass = "bg-[var(--status-maint-bg)] text-[var(--status-maint-fg)] border-[var(--status-maint-border)]";
  } else if (readinessState === "not_ready") {
    label = t.operationalState.readinessState.not_ready;
    colorClass = "bg-[var(--status-issue-bg)] text-[var(--status-issue-fg)] border-[var(--status-issue-border)]";
  } else if (custodyState === "untracked" || readinessState === "unknown") {
    label = t.operationalState.readinessState.unknown;
    colorClass = "bg-muted text-muted-foreground border-border";
  } else {
    label = t.operationalState.notDeployable;
    colorClass = "bg-muted text-muted-foreground border-border";
  }

  return (
    <span
      className={cn(
        "inline-flex items-center rounded border font-medium",
        compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs",
        colorClass,
      )}
    >
      {label}
    </span>
  );
}
