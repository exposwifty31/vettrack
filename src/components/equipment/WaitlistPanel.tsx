import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Equipment } from "@/types";
import { isOnline } from "@/lib/safe-browser";

interface WaitlistPanelProps {
  equipment: Equipment;
  currentUserId: string;
}

function formatCountdown(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

export function WaitlistPanel({ equipment, currentUserId }: WaitlistPanelProps) {
  const queryClient = useQueryClient();
  const [countdown, setCountdown] = useState("");

  const eligible =
    equipment.custodyState === "checked_out" &&
    !!equipment.checkedOutById &&
    equipment.checkedOutById !== currentUserId;

  const waitlistQ = useQuery({
    queryKey: ["equipment-waitlist", equipment.id],
    queryFn: () => api.equipment.waitlist(equipment.id),
    enabled: eligible,
  });

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

  const snapshot = waitlistQ.data;
  const reservationExpiresAt = snapshot?.reservationExpiresAt ?? null;
  const isNotified = snapshot?.myStatus === "notified";

  useEffect(() => {
    if (!reservationExpiresAt || !isNotified) {
      setCountdown("");
      return;
    }
    const tick = () => setCountdown(formatCountdown(reservationExpiresAt));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [reservationExpiresAt, isNotified]);

  if (!eligible) return null;

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
    <div className="space-y-3 rounded-lg border border-border p-4">
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

      {isNotified && (
        <div className="rounded-md bg-primary/10 px-3 py-2 text-sm">
          <p className="font-medium">{t.equipmentWaitlist.notifiedBanner}</p>
          {reservationExpiresAt && (
            <p className="text-muted-foreground">
              {t.equipmentWaitlist.reservationExpires}: {countdown}
            </p>
          )}
        </div>
      )}

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
