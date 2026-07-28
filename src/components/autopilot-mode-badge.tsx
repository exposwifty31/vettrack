import { Badge } from "@/components/ui/badge";
import { t } from "@/lib/i18n";

/**
 * VetTrack 2.0, Task 1.1 §6 — the shared shadow-vs-enforce visual language.
 * `shadow` is the current state everywhere in this task (every evaluator
 * family + every Autopilot proposal kind ships shadow-only here); `enforce`
 * exists so Task 0.4/2.5 console consumers (the Autopilot Policy screen)
 * import the SAME badge rather than duplicating the copy/visual pair —
 * named once per this task's plan (§6, "Shared components").
 */
export type AutopilotMode = "shadow" | "enforce";

export function AutopilotModeBadge({ mode }: { mode: AutopilotMode }) {
  return (
    <Badge
      data-testid={`autopilot-mode-badge-${mode}`}
      variant={mode === "enforce" ? "ok" : "maintenance"}
    >
      {mode === "enforce" ? t.autopilotQueue.modeBadge.enforce : t.autopilotQueue.modeBadge.shadow}
    </Badge>
  );
}
