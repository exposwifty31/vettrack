import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, RefreshCw, UserCog } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Bdi } from "@/components/ui/bdi";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import { useAuth } from "@/hooks/use-auth";
import { formatRelativeTime } from "@/lib/utils";

interface CoordinatorSweepStateProps {
  /** Most recent source:"sweep" anchor's assertedAt for this room (Room type, T3.4-i-b Part A). */
  lastSweptAt?: string | null;
  /** Display name of whoever asserted that anchor. */
  lastSweptByName?: string | null;
}

/**
 * Docking P3 T3.4-i-b (Parts C/D) — compact room-radar status line: this
 * shift's derived Equipment Coordinator (T3.4-i-a) + this room's last-swept
 * state (T3.2a/T3.3). Rendered near the Room Sweep entry in room-radar.tsx.
 *
 * The Coordinator query is intentionally NOT room-scoped — it's one
 * per-shift value, per design (assignment ≠ eligibility ≠ per-room).
 * When ambiguous (`needs_confirmation`), only the shift's senior tech or an
 * admin gets the inline confirm picker; everyone else sees a read-only
 * "to be confirmed" line.
 */
export function CoordinatorSweepState({ lastSweptAt, lastSweptByName }: CoordinatorSweepStateProps) {
  const { userId, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  // Recomputed every render (NOT memoized) — included in the query key (not
  // passed to shiftCoordinator(), which defaults to "today" clinic-side)
  // purely so a tab/kiosk left open across midnight naturally re-fetches
  // instead of freezing on the mount-time day forever. `useMemo(fn, [])`
  // would compute once and never bust; the date-string format is cheap
  // enough to just recompute. UTC-midnight flip vs. clinic-local tz is an
  // accepted minor — matches how other client date keys work.
  const todayLocal = new Date().toISOString().slice(0, 10);

  const {
    data: coordinator,
    isError: coordinatorError,
    isFetching: coordinatorFetching,
    refetch: refetchCoordinator,
  } = useQuery({
    queryKey: ["/api/docking/coordinator", todayLocal],
    queryFn: () => api.docking.shiftCoordinator(),
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const confirmMut = useMutation({
    mutationFn: (coordinatorUserId: string) =>
      // Non-null assertion is safe: this mutationFn is only invoked from the
      // `canConfirm`-gated Select below (line ~99), which itself requires
      // `!!coordinator` — `coordinator` is guaranteed defined by the time a
      // confirm selection can fire.
      api.docking.confirmCoordinator({ shiftDate: coordinator!.shiftDate, coordinatorUserId }),
    onSuccess: () => {
      toast.success(t.coordinator.confirmSuccess);
      queryClient.invalidateQueries({ queryKey: ["/api/docking/coordinator"] });
    },
    onError: () => toast.error(t.coordinator.confirmError),
  });

  const canConfirm =
    !!coordinator &&
    coordinator.status === "needs_confirmation" &&
    (coordinator.seniorTechUserId === userId || isAdmin);

  const sweptText = lastSweptAt
    ? `${t.coordinator.sweptPrefix} ${formatRelativeTime(lastSweptAt)}${
        lastSweptByName ? ` ${t.coordinator.byName(lastSweptByName)}` : ""
      }`
    : t.coordinator.notSweptThisShift;

  return (
    <div className="flex flex-col gap-1.5 mt-3 text-xs text-muted-foreground" data-testid="coordinator-sweep-state">
      {coordinatorError ? (
        <button
          type="button"
          data-testid="coordinator-load-error"
          onClick={() => refetchCoordinator()}
          disabled={coordinatorFetching}
          className="flex items-center gap-1.5 text-destructive disabled:opacity-50"
        >
          <UserCog className="w-3.5 h-3.5 shrink-0" aria-hidden />
          {t.coordinator.loadError}
          <RefreshCw className="w-3 h-3 shrink-0" aria-hidden />
          {t.errorCard.retry}
        </button>
      ) : (
        coordinator &&
        (coordinator.status === "needs_confirmation" ? (
          canConfirm ? (
            <div className="flex items-center gap-2" data-testid="coordinator-confirm-picker">
              <UserCog className="w-3.5 h-3.5 shrink-0" aria-hidden />
              <Select onValueChange={(val) => confirmMut.mutate(val)} disabled={confirmMut.isPending}>
                <SelectTrigger className="h-7 w-auto min-w-[10rem] text-xs" data-testid="coordinator-confirm-select">
                  <SelectValue placeholder={t.coordinator.choosePlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {coordinator.candidates.map((c) => (
                    <SelectItem key={c.userId} value={c.userId}>
                      <Bdi>{c.name}</Bdi>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <span className="flex items-center gap-1.5" data-testid="coordinator-line">
              <UserCog className="w-3.5 h-3.5 shrink-0" aria-hidden />
              {t.coordinator.toBeConfirmed}
            </span>
          )
        ) : (
          <span className="flex items-center gap-1.5" data-testid="coordinator-line">
            <UserCog className="w-3.5 h-3.5 shrink-0" aria-hidden />
            {coordinator.coordinatorName ? t.coordinator.withName(coordinator.coordinatorName) : t.coordinator.unassigned}
          </span>
        ))
      )}

      <span
        className={`flex items-center gap-1.5 ${lastSweptAt ? "text-[var(--status-ok-fg)] font-medium" : ""}`}
        data-testid="sweep-state-line"
      >
        {lastSweptAt && <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden />}
        <Bdi>{sweptText}</Bdi>
      </span>
    </div>
  );
}
