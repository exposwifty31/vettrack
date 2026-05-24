import { t } from "@/lib/i18n";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import type { AssetTypeCondition, UnitConditionState } from "@/types";

interface ConditionEntry {
  conditionId: string;
  verified: boolean;
  notes?: string;
}

interface ConditionChecklistProps {
  conditions: AssetTypeCondition[];
  existingStates: UnitConditionState[];
  value: ConditionEntry[];
  onChange: (v: ConditionEntry[]) => void;
}

function isStale(state: UnitConditionState, cond: AssetTypeCondition): boolean {
  if (!state.verified || !state.verifiedAt) return false;
  return Date.now() - new Date(state.verifiedAt).getTime() > cond.staleAfterMinutes * 60 * 1000;
}

function methodLabel(method: string): string {
  if (method === "visual") return t.bundleConditions.verificationMethod.visual;
  if (method === "electronic") return t.bundleConditions.verificationMethod.electronic;
  return t.bundleConditions.verificationMethod.manual;
}

export function ConditionChecklist({ conditions, existingStates, value, onChange }: ConditionChecklistProps) {
  function update(conditionId: string, patch: Partial<ConditionEntry>) {
    const existing = value.find((e) => e.conditionId === conditionId);
    if (existing) {
      onChange(value.map((e) => (e.conditionId === conditionId ? { ...e, ...patch } : e)));
    } else {
      onChange([...value, { conditionId, verified: false, ...patch }]);
    }
  }

  return (
    <div className="space-y-3">
      {conditions.map((cond) => {
        const entry = value.find((e) => e.conditionId === cond.id);
        const existing = existingStates.find((s) => s.conditionId === cond.id);
        const stale = existing ? isStale(existing, cond) : false;

        let statusLabel: string | null = null;
        if (existing?.verified && !stale) {
          statusLabel = existing.verifiedAt
            ? `${t.bundleConditions.verified} · ${new Date(existing.verifiedAt).toLocaleTimeString()}`
            : t.bundleConditions.verified;
        } else if (stale) {
          statusLabel = t.bundleConditions.stale;
        } else if (existing) {
          statusLabel = t.bundleConditions.notVerified;
        }

        return (
          <div key={cond.id} className="border rounded-md p-3 space-y-2">
            <div className="flex items-start gap-3">
              <Checkbox
                id={`cond-${cond.id}`}
                checked={entry?.verified ?? false}
                onCheckedChange={(checked) => update(cond.id, { verified: Boolean(checked) })}
              />
              <div className="flex-1 min-w-0">
                <Label htmlFor={`cond-${cond.id}`} className="text-sm font-medium cursor-pointer">
                  {cond.conditionName}
                </Label>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-muted-foreground">{methodLabel(cond.verificationMethod)}</span>
                  {statusLabel && (
                    <span
                      className={`text-[10px] ${stale ? "text-amber-600" : existing?.verified ? "text-emerald-600" : "text-muted-foreground"}`}
                    >
                      {statusLabel}
                    </span>
                  )}
                </div>
              </div>
            </div>
            {entry?.verified && (
              <Input
                placeholder="Notes (optional)"
                value={entry.notes ?? ""}
                onChange={(e) => update(cond.id, { notes: e.target.value })}
                className="text-sm h-7"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
