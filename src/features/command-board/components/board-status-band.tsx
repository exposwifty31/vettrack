// Task 8 — the board's anchor band: department identity, ready/total summary,
// coarse-bucket freshness with a per-poll heartbeat, clock, and the tinted
// state strip underneath. Presentational only — state/connection are computed
// upstream (useBoardState / useDisplayConnection) and passed in.
//
// Invariants honored here:
// - Absent ≠ zero: null counts render the muted-unavailable copy, never "0/0".
// - Numbers/clock are LTR-isolated (<bdi dir="ltr">) inside the RTL layout and
//   carry .board-nums (tabular-nums lining-nums). Nothing count-animates.
// - Freshness is coarse buckets only (<10 s / <60 s / floored minutes) — no
//   live-ticking seconds on a wall display.
import { t } from "@/lib/i18n";
import type { BoardStateKind } from "../board-state";
import type { DisplayConnection } from "@/hooks/use-display-connection";

const FRESHNESS_NOW_MS = 10_000;
const FRESHNESS_UNDER_MINUTE_MS = 60_000;

export function formatFreshness(
  lastSuccessAt: number | null,
  nowMs: number,
): { key: "now" | "underMinute" | "minutes"; minutes?: number } {
  // null = no successful poll yet. Callers (FreshnessChip) guard this case and
  // render the "updating" copy instead; the "now" bucket here is a safe default
  // for any caller that does not.
  if (lastSuccessAt == null) return { key: "now" };
  const ageMs = Math.max(0, nowMs - lastSuccessAt);
  if (ageMs < FRESHNESS_NOW_MS) return { key: "now" };
  if (ageMs < FRESHNESS_UNDER_MINUTE_MS) return { key: "underMinute" };
  return { key: "minutes", minutes: Math.floor(ageMs / 60_000) };
}

function freshnessLabel(lastSuccessAt: number | null, nowMs: number): string {
  if (lastSuccessAt == null) return t.board.updatingNow;
  const bucket = formatFreshness(lastSuccessAt, nowMs);
  if (bucket.key === "now") return t.board.freshnessNow;
  if (bucket.key === "underMinute") return t.board.freshnessUnderMinute;
  return t.board.freshnessMinutes(bucket.minutes ?? 0);
}

export function FreshnessChip({
  connection,
  nowMs,
}: {
  connection: DisplayConnection;
  nowMs: number;
}): JSX.Element {
  const { lastSuccessAt, state } = connection;
  return (
    <div
      data-testid="board-freshness-chip"
      data-connection={state}
      className="board-freshness-chip"
    >
      {/* key-driven remount fires the one-shot CSS pulse on every successful poll */}
      <span
        key={lastSuccessAt ?? "none"}
        data-testid="board-heartbeat"
        data-beat={lastSuccessAt ?? undefined}
        className="board-heartbeat"
        aria-hidden
      />
      <span className="board-nums">{freshnessLabel(lastSuccessAt, nowMs)}</span>
    </div>
  );
}

/** Thin full-width tint strip — data-state drives the color-mix wash in CSS. */
export function BoardStateStrip({ state }: { state: BoardStateKind }): JSX.Element {
  return (
    <div
      data-testid="board-state-strip"
      data-state={state}
      className="board-state-strip"
      aria-hidden
    />
  );
}

export function BoardTopBand({
  departmentLabel,
  readyCount,
  totalCount,
  currentTime,
  connection,
}: {
  departmentLabel: string;
  readyCount: number | null;
  totalCount: number | null;
  currentTime: string;
  connection: DisplayConnection;
}): JSX.Element {
  // Same clock treatment as the legacy header: he-IL HH:mm, never seconds.
  const parsed = new Date(currentTime);
  const timeStr = Number.isNaN(parsed.getTime())
    ? currentTime
    : parsed.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", hour12: false });
  const hasCounts = readyCount != null && totalCount != null;

  return (
    <header data-testid="board-top-band" className="board-top-band">
      <span className="board-top-band-dept">{departmentLabel}</span>
      <span data-testid="board-ready-summary" className="board-nums board-top-band-summary">
        {hasCounts ? (
          <bdi dir="ltr">{`${readyCount}/${totalCount}`}</bdi>
        ) : (
          // Absent board ⇒ unknown, never "0/0" (absent-vs-zero doctrine).
          t.board.blockUnavailable
        )}
      </span>
      <FreshnessChip connection={connection} nowMs={Date.now()} />
      <span data-testid="board-clock" className="board-nums board-top-band-clock">
        <bdi dir="ltr">{timeStr}</bdi>
      </span>
    </header>
  );
}
