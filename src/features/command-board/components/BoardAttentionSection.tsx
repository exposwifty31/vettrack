// R-BDF-1.2 — Board "attention" section. Glance-only ambient anomaly cards derived
// from the already-fetched board snapshot (no new transport). Cards are RANKED
// (severity → rule priority → since age → unitId) and calm/pressure-aware: calm stays
// quiet, pressure escalates color + size and — on the one-shot activation only —
// motion. prefers-reduced-motion swaps the animation for a static variant in BOTH
// modes (pressure still escalates color/size, just without animation). Adds ZERO
// interactive targets: every node here is inert display.
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { BoardAnomaly, BoardAnomalyType } from "../../../../shared/equipment-board";
import type { BoardMode } from "../use-board-mode";
import { rankBoardAnomalies } from "../board-anomaly-ranking";
import { boardAnomalyKey, useBoardAnomalyStateMachine } from "../use-board-anomaly-state-machine";

type CardMotion = "static" | "cross-fade" | "escalate";
type CardEmphasis = "quiet" | "escalated";

function anomalyTypeLabel(type: BoardAnomalyType): string {
  switch (type) {
    case "battery_critical":
      return t.board.anomalyBatteryCritical;
    case "rfid_reader_offline":
      return t.board.rfidReaderOffline;
    case "cart_unverified":
      return t.board.anomalyCartUnverified;
  }
}

function sinceLabel(since: string): string | null {
  const at = new Date(since);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function AnomalyCard({
  anomaly,
  rank,
  emphasis,
  motion,
}: {
  anomaly: BoardAnomaly;
  rank: number;
  emphasis: CardEmphasis;
  motion: CardMotion;
}) {
  const escalated = emphasis === "escalated";
  const since = sinceLabel(anomaly.since);
  return (
    <div
      data-testid={`board-anomaly-${anomaly.type}-${anomaly.unitId}`}
      data-anomaly-type={anomaly.type}
      data-anomaly-unit={anomaly.unitId}
      data-anomaly-severity={anomaly.severity}
      data-anomaly-rank={rank}
      data-anomaly-emphasis={emphasis}
      data-anomaly-motion={motion}
      className={cn(
        "rounded-xl border flex flex-col gap-0.5",
        escalated
          ? "p-4 border-[var(--status-issue-border)] bg-[var(--status-issue-bg)]"
          : "p-2.5 border-ivory-border bg-[rgb(var(--ivory-surface))]",
        // Motion clarifies, never alarms: single-shot entrance only, and only when
        // the JS gate (reduced-motion / held) allows it. motion-safe is a CSS backstop.
        motion === "escalate" && "motion-safe:animate-[pulse_600ms_ease-out_1]",
        motion === "cross-fade" && "motion-safe:animate-[fadeIn_300ms_ease-out_1]",
      )}
    >
      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            "font-bold",
            escalated
              ? "vt-text-lg text-[var(--status-issue-fg)]"
              : "vt-text-sm text-ivory-text",
          )}
        >
          {anomalyTypeLabel(anomaly.type)}
        </span>
        <span className="vt-text-xs tabular-nums text-ivory-text3 truncate">{anomaly.unitId}</span>
      </div>
      {since && (
        <span className="vt-text-2xs text-ivory-text3">
          {t.board.anomalySince} {since}
        </span>
      )}
    </div>
  );
}

export function BoardAttentionSection({
  anomalies,
  mode,
  reducedMotion,
  onAnomalyActivated,
}: {
  anomalies: readonly BoardAnomaly[];
  mode: BoardMode;
  reducedMotion: boolean;
  /** R-BDF-1.3 telemetry seam — fires once per `(type,unitId)` activation. */
  onAnomalyActivated?: (anomaly: BoardAnomaly) => void;
}) {
  const { justActivatedKeys } = useBoardAnomalyStateMachine(anomalies, onAnomalyActivated);
  const ranked = rankBoardAnomalies(anomalies);
  if (ranked.length === 0) return null;

  return (
    <section
      data-testid="board-attention"
      data-board-mode={mode}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      aria-label={t.board.attention}
      className={cn(
        "shrink-0 mx-4 mt-3 rounded-xl border p-3",
        mode === "pressure"
          ? "border-[var(--status-issue-border)] bg-[var(--status-issue-bg)]"
          : "border-ivory-border bg-[rgb(var(--ivory-surface))]",
      )}
    >
      <h2
        className={cn(
          "vt-text-2xs font-bold uppercase tracking-widest mb-2",
          mode === "pressure" ? "text-[var(--status-issue-fg)]" : "text-ivory-text3",
        )}
      >
        {t.board.attention} · {ranked.length}
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {ranked.map((anomaly, rank) => {
          const emphasis: CardEmphasis =
            mode === "pressure" && anomaly.severity === "pressure" ? "escalated" : "quiet";
          const isFresh = justActivatedKeys.has(boardAnomalyKey(anomaly));
          let motion: CardMotion = "static";
          if (!reducedMotion && isFresh) {
            motion = emphasis === "escalated" ? "escalate" : "cross-fade";
          }
          return (
            <AnomalyCard
              key={boardAnomalyKey(anomaly)}
              anomaly={anomaly}
              rank={rank}
              emphasis={emphasis}
              motion={motion}
            />
          );
        })}
      </div>
    </section>
  );
}
