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
    colorClass = "bg-emerald-100 text-emerald-800 border-emerald-200";
  } else if (usageState === "in_use") {
    label = t.operationalState.usageState.in_use;
    colorClass = "bg-blue-100 text-blue-800 border-blue-200";
  } else if (usageState === "emergency_use") {
    label = t.operationalState.usageState.emergency_use;
    colorClass = "bg-red-100 text-red-800 border-red-200";
  } else if (usageState === "procedure_bound") {
    label = t.operationalState.usageState.procedure_bound;
    colorClass = "bg-purple-100 text-purple-800 border-purple-200";
  } else if (usageState === "staged") {
    label = t.operationalState.usageState.staged;
    colorClass = "bg-amber-100 text-amber-800 border-amber-200";
  } else if (readinessState === "not_ready") {
    label = t.operationalState.readinessState.not_ready;
    colorClass = "bg-red-100 text-red-800 border-red-200";
  } else if (custodyState === "untracked" || readinessState === "unknown") {
    label = t.operationalState.readinessState.unknown;
    colorClass = "bg-gray-100 text-gray-600 border-gray-200";
  } else {
    label = t.operationalState.notDeployable;
    colorClass = "bg-gray-100 text-gray-600 border-gray-200";
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
