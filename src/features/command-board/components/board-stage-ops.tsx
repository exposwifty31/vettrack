// TV board phase 1 (Task 11) — the Ops stage: the second face of the rotating
// stage (Equipment↔Ops). People + queues, 10-foot sized:
//   - waitlist / staging depth as large evidence panels — a zero-but-present
//     block earns the explicit "nothing waiting" phrase (good news with
//     evidence), while an ABSENT block renders the muted-unknown card
//     (absent ≠ zero, binding);
//   - the shift strip relocated from CommandBoard's header: who is on shift
//     right now, name + role, readable from the corridor.
// Rotation, locking, and single-view mode live in ../use-stage-rotation.ts —
// this component only renders what it is given.
import { Hourglass, PackageCheck, Users } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { EquipmentCommandBoardSnapshot } from "@/types/safety-surfaces";
import { UnknownBlock } from "./board-panels";

/** Localized role label — falls back to the raw role for unknown values. */
function roleLabel(role: string): string {
  const roles = t.profile.roles as Record<string, string | undefined>;
  return roles[role] ?? role;
}

/** One queue as 10-foot evidence: big tabular number, or the explicit empty phrase. */
function OpsQueuePanel({
  title,
  depth,
  emptyPhrase,
  icon,
  tvMode,
}: {
  title: string;
  depth: number;
  emptyPhrase: string;
  icon: JSX.Element;
  tvMode?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex-1 rounded-2xl border border-ivory-border bg-[rgb(var(--ivory-surface))] flex flex-col gap-2",
        tvMode ? "p-6" : "p-4",
      )}
      data-testid={`board-ops-queue-${title}`}
    >
      <div className="flex items-center gap-2 vt-text-2xs font-bold uppercase tracking-widest text-ivory-text3">
        {icon}
        <span>{title}</span>
      </div>
      {depth > 0 ? (
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "board-nums font-black tabular-nums leading-none text-ivory-text",
              tvMode ? "text-[72px]" : "vt-display",
            )}
          >
            {depth}
          </span>
          <span className="vt-text-sm text-ivory-text3">{t.board.inQueue}</span>
        </div>
      ) : (
        <span className={cn("font-semibold text-ivory-text2", tvMode ? "vt-text-lg" : "vt-text-sm")}>
          {emptyPhrase}
        </span>
      )}
    </div>
  );
}

export function OpsStage({
  board,
  currentShift,
  tvMode,
}: {
  board: EquipmentCommandBoardSnapshot;
  currentShift: Array<{ employeeName: string; role: string }>;
  tvMode?: boolean;
}): JSX.Element {
  return (
    <section
      data-testid="board-stage"
      data-stage="ops"
      className={cn("flex-1 min-h-0 overflow-auto flex flex-col", tvMode ? "gap-6" : "gap-4")}
    >
      {/* Queues — absent ≠ zero: an undefined block is muted-unknown, never the empty phrase */}
      <div className={cn("flex flex-col sm:flex-row items-stretch", tvMode ? "gap-6" : "gap-4")}>
        {board.waitlist ? (
          <OpsQueuePanel
            title={t.board.waitlist}
            depth={board.waitlist.depth}
            emptyPhrase={t.board.opsEmptyWaitlist}
            icon={<Hourglass className="h-4 w-4" aria-hidden />}
            tvMode={tvMode}
          />
        ) : (
          <div className="flex-1">
            <UnknownBlock title={t.board.waitlist} />
          </div>
        )}
        {board.staging ? (
          <OpsQueuePanel
            title={t.board.staging}
            depth={board.staging.depth}
            emptyPhrase={t.board.opsEmptyStaging}
            icon={<PackageCheck className="h-4 w-4" aria-hidden />}
            tvMode={tvMode}
          />
        ) : (
          <div className="flex-1">
            <UnknownBlock title={t.board.staging} />
          </div>
        )}
      </div>

      {/* Shift strip — relocated from the CommandBoard header (Task 11) */}
      <div
        className={cn(
          "rounded-2xl border border-ivory-border bg-[rgb(var(--ivory-surface))] flex flex-col gap-3",
          tvMode ? "p-6" : "p-4",
        )}
        data-testid="board-ops-shift"
      >
        <div className="flex items-center gap-2 vt-text-2xs font-bold uppercase tracking-widest text-ivory-text3">
          <Users className="h-4 w-4" aria-hidden />
          <span>{t.board.opsShiftTitle}</span>
        </div>
        <div className={cn("flex flex-wrap", tvMode ? "gap-3" : "gap-2")}>
          {currentShift.map((s) => (
            <span
              key={`${s.employeeName}-${s.role}`}
              className={cn(
                "inline-flex items-baseline gap-2 rounded-full border border-ivory-border bg-[rgb(var(--ivory-bg))]",
                tvMode ? "px-5 py-2" : "px-3 py-1",
              )}
            >
              <span className={cn("font-bold text-ivory-text", tvMode ? "vt-text-lg" : "vt-text-sm")}>
                {s.employeeName}
              </span>
              <span className={cn("text-ivory-text3", tvMode ? "vt-text-sm" : "vt-text-xs")}>
                {roleLabel(s.role)}
              </span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
