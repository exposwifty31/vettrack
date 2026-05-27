import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Equipment } from "@/types";
import { isOnline } from "@/lib/safe-browser";
import { shouldShowWaitlistJoinPanel } from "@/lib/equipment-waitlist-ui";
import type { EquipmentWaitlistSnapshot } from "../../../shared/equipment-waitlist";

interface WaitlistPanelProps {
  equipment: Equipment;
  currentUserId: string;
  /** When provided, skips a duplicate waitlist fetch (equipment detail passes shared snapshot). */
  snapshot?: EquipmentWaitlistSnapshot | null;
}

export function WaitlistPanel({ equipment, currentUserId, snapshot: snapshotProp }: WaitlistPanelProps) {
  const queryClient = useQueryClient();
  const showJoinQueue = shouldShowWaitlistJoinPanel(equipment, currentUserId);

  const waitlistQ = useQuery({
    queryKey: ["equipment-waitlist", equipment.id],
    queryFn: () => api.equipment.waitlist(equipment.id),
    enabled: showJoinQueue && snapshotProp === undefined,
  });

  const snapshot = snapshotProp ?? waitlistQ.data;

  const joinMut = useMutation({
    mutationFn: () => api.equipment.joinWaitlist(equipment.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["equipment-waitlist", equipment.id] });
      toast.success(t.equipmentWaitlist.join);
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        toast.error(err.message);
      }
    },
  });

  const leaveMut = useMutation({
    mutationFn: () => api.equipment.leaveWaitlist(equipment.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["equipment-waitlist", equipment.id] });
    },
  });

  if (!showJoinQueue) return null;

  const onJoin = () => {
    if (!isOnline()) {
      toast.error(t.equipmentWaitlist.offlineBlocked);
      return;
    }
    joinMut.mutate();
  };

  const onLeave = () => {
    if (!isOnline()) {
      toast.error(t.equipmentWaitlist.offlineBlocked);
      return;
    }
    leaveMut.mutate();
  };

  const myOnWaitlist = snapshot?.myStatus === "waiting" || snapshot?.myStatus === "notified";

  return (
    <div className="space-y-3 rounded-lg border border-border p-4" data-testid="equipment-waitlist-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{t.equipmentWaitlist.title}</h4>
        {!myOnWaitlist ? (
          <Button size="sm" onClick={onJoin} disabled={joinMut.isPending}>
            {t.equipmentWaitlist.join}
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={onLeave} disabled={leaveMut.isPending}>
            {t.equipmentWaitlist.leave}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
        <span>
          {t.equipmentWaitlist.queueSize}: <strong>{snapshot?.queueSize ?? 0}</strong>
        </span>
        {snapshot?.myPosition != null && snapshot.myPosition > 0 && (
          <span>
            {t.equipmentWaitlist.myPosition}: <Badge variant="secondary">{snapshot.myPosition}</Badge>
          </span>
        )}
      </div>

      {(snapshot?.entries?.length ?? 0) > 0 && (
        <ul className="space-y-1 text-sm">
          {snapshot!.entries.map((entry) => (
            <li key={entry.userId} className="flex justify-between gap-2">
              <span className="truncate">{entry.displayName}</span>
              <span className="shrink-0 text-muted-foreground">
                {entry.status === "notified"
                  ? t.equipmentWaitlist.notifiedBanner
                  : `#${entry.position}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
