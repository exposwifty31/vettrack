import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Equipment, StagingClaim } from "@/types";

interface StagingQueuePanelProps {
  equipment: Equipment;
  currentUserId: string;
}

function priorityBadgeVariant(p: string) {
  if (p === "emergency") return "destructive" as const;
  if (p === "urgent") return "secondary" as const;
  return "outline" as const;
}

export function StagingQueuePanel({ equipment, currentUserId }: StagingQueuePanelProps) {
  const queryClient = useQueryClient();

  const eligible =
    equipment.custodyState === "docked" &&
    (equipment.usageState === "available" || equipment.usageState === "staged");

  const queueQ = useQuery({
    queryKey: ["staging-queue", equipment.id],
    queryFn: () => api.operationalState.stagingQueue(equipment.id),
    enabled: eligible,
    refetchInterval: 30_000,
  });

  const stageMut = useMutation({
    mutationFn: (priority: "routine" | "urgent" | "emergency") =>
      api.operationalState.stage(equipment.id, { clinicalPriority: priority }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staging-queue", equipment.id] });
      toast.success(t.stagingQueue.requestStage);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        toast.error(t.stagingQueue.conflict);
      }
    },
  });

  const cancelMut = useMutation({
    mutationFn: (claimId: string) => api.operationalState.cancelStage(equipment.id, claimId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staging-queue", equipment.id] });
    },
  });

  if (!eligible) return null;

  const claims = queueQ.data ?? [];
  const activeClaims = claims.filter((c: StagingClaim) => c.status === "active");
  const myClaim = activeClaims.find((c: StagingClaim) => c.requestedById === currentUserId);
  const myPosition = myClaim
    ? activeClaims.findIndex((c: StagingClaim) => c.requestedById === currentUserId) + 1
    : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">{t.stagingQueue.title}</h4>
        {!myClaim && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => stageMut.mutate("routine")}
            disabled={stageMut.isPending}
          >
            {t.stagingQueue.requestStage}
          </Button>
        )}
      </div>

      {myPosition === 1 && (
        <p className="text-xs text-emerald-600 font-medium">{t.stagingQueue.youAreFirst}</p>
      )}
      {myPosition && myPosition > 1 && (
        <p className="text-xs text-muted-foreground">
          {t.stagingQueue.myPosition}: #{myPosition}
        </p>
      )}

      <div className="space-y-1.5">
        {activeClaims.map((claim: StagingClaim, idx: number) => (
          <div key={claim.id} className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground w-4">#{idx + 1}</span>
            <Badge variant={priorityBadgeVariant(claim.clinicalPriority)} className="text-[10px]">
              {t.stagingQueue.priority[claim.clinicalPriority as keyof typeof t.stagingQueue.priority]}
            </Badge>
            {claim.expiresAt && (
              <span className="text-muted-foreground">
                {t.stagingQueue.expiresAt} {new Date(claim.expiresAt).toLocaleTimeString()}
              </span>
            )}
            {claim.requestedById === currentUserId && (
              <Button
                size="sm"
                variant="ghost"
                className="h-5 text-xs px-1.5 ml-auto text-destructive"
                onClick={() => cancelMut.mutate(claim.id)}
                disabled={cancelMut.isPending}
              >
                {t.stagingQueue.cancelClaim}
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
