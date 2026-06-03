import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";
import { api } from "@/lib/api";
import type { CopilotExplainResponse } from "../../../shared/contracts/asset-copilot.v1";

interface AssetCopilotPanelProps {
  className?: string;
  /** When set, explains this asset immediately on CTA. */
  defaultEquipmentId?: string;
}

export function AssetCopilotPanel({ className, defaultEquipmentId }: AssetCopilotPanelProps) {
  const [equipmentId, setEquipmentId] = useState(defaultEquipmentId ?? "");
  const [result, setResult] = useState<CopilotExplainResponse | null>(null);

  const { data: capabilities, isLoading: capsLoading } = useQuery({
    queryKey: ["/api/platform/capabilities"],
    queryFn: () => api.platform.capabilities(),
    staleTime: 60_000,
  });

  const explainMutation = useMutation({
    mutationFn: (id: string) => api.equipment.copilotExplain(id.trim()),
    onSuccess: (data) => setResult(data),
    onError: () => setResult(null),
  });

  const enabled = capabilities?.assetCopilot === true;
  const busy = explainMutation.isPending;

  const handleExplain = () => {
    const id = equipmentId.trim();
    if (!id || !enabled) return;
    explainMutation.mutate(id);
  };

  return (
    <section
      className={cn(
        "overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card p-5 shadow-card",
        className,
      )}
      data-testid="asset-copilot-panel"
    >
      <div className="mb-3 flex items-center gap-2 text-primary">
        <Sparkles className="h-5 w-5" aria-hidden />
        <span className="text-xs font-bold uppercase tracking-[0.14em]">{t.assetCopilot.title}</span>
      </div>
      <p className="text-sm text-muted-foreground">{t.assetCopilot.description}</p>

      {capsLoading ? (
        <div className="mt-4 flex justify-center py-4">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
        </div>
      ) : !enabled ? (
        <p className="mt-4 rounded-xl border border-dashed border-border bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
          {t.assetCopilot.disabledHint}
        </p>
      ) : (
        <>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Input
              value={equipmentId}
              onChange={(e) => setEquipmentId(e.target.value)}
              placeholder={t.assetCopilot.equipmentIdPlaceholder}
              className="min-w-0 flex-1"
              data-testid="asset-copilot-equipment-id"
              onKeyDown={(e) => e.key === "Enter" && handleExplain()}
            />
            <Button
              type="button"
              className="shrink-0 gap-2"
              onClick={handleExplain}
              disabled={busy || !equipmentId.trim()}
              data-testid="asset-copilot-explain"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
              {t.assetCopilot.explainCta}
            </Button>
          </div>

          {explainMutation.isError && (
            <p className="mt-3 text-sm text-destructive">{t.assetCopilot.error}</p>
          )}

          {result && (
            <div
              className="mt-4 space-y-3 rounded-2xl border border-border bg-background/80 p-4"
              data-testid="asset-copilot-result"
            >
              <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">{result.narrative}</p>
              {result.answer.claims.length > 0 && (
                <ul className="space-y-2 border-t border-border pt-3">
                  {result.answer.claims.slice(0, 4).map((claim) => (
                    <li key={claim.key} className="text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">{claim.value}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
