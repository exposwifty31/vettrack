import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarClock, LogOut, Check, X, Inbox } from "lucide-react";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import type { ShiftAdjustment, ShiftAdjustmentDecision } from "@/types";
import { Button } from "@/components/ui/button";
import { Bdi } from "@/components/ui/bdi";

/**
 * Admin approvals list for shift-adjustment requests (Phase 1, increment 3).
 * Shows every pending extend / leave-early request with its window change and
 * reason, and lets an admin approve or reject it. An approved request moves the
 * requester's effective shift window in role-resolution (server-side).
 */

const PENDING_KEY = ["/api/shift-adjustments", "pending"] as const;

/** "HH:MM:SS" → "HH:MM". */
function hm(time: string): string {
  return time.slice(0, 5);
}

export function AdminShiftRequestsSection() {
  const queryClient = useQueryClient();
  const { data: requests, isLoading } = useQuery({
    queryKey: PENDING_KEY,
    queryFn: () => api.shiftAdjustments.list("pending"),
  });

  const decideMut = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: ShiftAdjustmentDecision }) =>
      api.shiftAdjustments.decide(id, decision),
    onSuccess: (_row, { decision }) => {
      toast.success(
        decision === "approved"
          ? t.shiftAdjustments.admin.approvedToast
          : t.shiftAdjustments.admin.rejectedToast,
      );
      queryClient.invalidateQueries({ queryKey: ["/api/shift-adjustments"] });
    },
    onError: () => toast.error(t.shiftAdjustments.admin.decideFailed),
  });

  const rows = requests ?? [];

  return (
    <section aria-label={t.shiftAdjustments.admin.title} className="flex flex-col gap-3">
      <h2 className="text-lg font-bold">{t.shiftAdjustments.admin.title}</h2>

      {isLoading ? (
        <div className="space-y-3" aria-hidden>
          <div className="h-24 rounded-2xl bg-muted animate-pulse" />
          <div className="h-24 rounded-2xl bg-muted animate-pulse" />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border py-14 text-center">
          <Inbox className="h-9 w-9 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">{t.shiftAdjustments.admin.empty}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((req) => (
            <ShiftRequestCard
              key={req.id}
              req={req}
              busy={decideMut.isPending}
              onDecide={(decision) => decideMut.mutate({ id: req.id, decision })}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

interface CardProps {
  req: ShiftAdjustment;
  busy: boolean;
  onDecide: (decision: ShiftAdjustmentDecision) => void;
}

function ShiftRequestCard({ req, busy, onDecide }: CardProps) {
  const isExtend = req.kind === "extend";
  const KindIcon = isExtend ? CalendarClock : LogOut;
  return (
    <li className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-foreground">
            <Bdi>{req.requesterName}</Bdi>
          </p>
          <span
            className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground"
          >
            <KindIcon className="h-3.5 w-3.5" aria-hidden />
            {isExtend
              ? t.shiftAdjustments.admin.kindExtend
              : t.shiftAdjustments.admin.kindLeaveEarly}
          </span>
        </div>
        <p
          className="font-num text-sm font-semibold tabular-nums text-foreground"
          dir="ltr"
        >
          {hm(req.currentEndTime)} → {hm(req.requestedEndTime)}
        </p>
      </div>

      <p className="mt-3 text-sm text-foreground/90">
        <span className="text-muted-foreground">{t.shiftAdjustments.admin.reasonLabel}: </span>
        <Bdi>{req.reason}</Bdi>
      </p>

      <div className="mt-4 flex gap-2.5">
        <Button
          type="button"
          className="flex-1"
          disabled={busy}
          onClick={() => onDecide("approved")}
          data-testid="btn-approve-adjustment"
        >
          <Check className="h-4 w-4" aria-hidden />
          {t.shiftAdjustments.admin.approve}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          disabled={busy}
          onClick={() => onDecide("rejected")}
          data-testid="btn-reject-adjustment"
        >
          <X className="h-4 w-4" aria-hidden />
          {t.shiftAdjustments.admin.reject}
        </Button>
      </div>
    </li>
  );
}
