import { t } from "@/lib/i18n";
import { StatusBadge } from "@/components/ui/status-badge";
import type { StatusKind } from "@/lib/design-tokens";
import type { CustodyState, ReadinessState, UsageState } from "@/types";

export interface DeployabilityVerdictProps {
  custodyState?: CustodyState | null;
  readinessState?: ReadinessState | null;
  usageState?: UsageState | null;
  fullDeployable?: boolean;
}

interface Verdict {
  kind: StatusKind;
  label: string;
}

/** Pure verdict resolver — maps equipment state props to a StatusKind + label. */
export function resolveDeployabilityVerdict(props: DeployabilityVerdictProps): Verdict | null {
  const { custodyState, readinessState, usageState, fullDeployable } = props;
  if (custodyState == null) return null;

  if (fullDeployable) {
    return { kind: "ok",          label: t.operationalState.fullDeployable };
  }
  if (usageState === "in_use") {
    return { kind: "sterilized",  label: t.operationalState.usageState.in_use };
  }
  if (usageState === "emergency_use") {
    return { kind: "issue",       label: t.operationalState.usageState.emergency_use };
  }
  if (usageState === "procedure_bound") {
    return { kind: "sterilized",  label: t.operationalState.usageState.procedure_bound };
  }
  if (usageState === "staged") {
    return { kind: "maintenance", label: t.operationalState.usageState.staged };
  }
  if (readinessState === "not_ready") {
    return { kind: "issue",       label: t.operationalState.readinessState.not_ready };
  }
  if (custodyState === "untracked" || readinessState === "unknown") {
    return { kind: "neutral",     label: t.operationalState.readinessState.unknown };
  }
  return   { kind: "neutral",     label: t.operationalState.notDeployable };
}

interface DeployabilityBadgeProps extends DeployabilityVerdictProps {
  compact?: boolean;
}

/** Renders a deployability verdict using the shared StatusBadge primitive. */
export function DeployabilityBadge({ compact, ...props }: DeployabilityBadgeProps) {
  const verdict = resolveDeployabilityVerdict(props);
  if (!verdict) return null;

  return (
    <StatusBadge
      kind={verdict.kind}
      label={verdict.label}
      className={compact ? "text-[10px] px-1.5 py-0.5" : undefined}
    />
  );
}
