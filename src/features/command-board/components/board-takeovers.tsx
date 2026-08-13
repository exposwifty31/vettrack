// Phase 1 (Task 9) — full-stage takeover screens for the /board kiosk.
//
// Two board states replace the whole stage instead of decorating it:
//   - stale/offline: the connection tracker says the data can no longer be
//     trusted live. The board says so in 10-foot type and keeps the LAST KNOWN
//     state on screen, clearly labeled — never silently zeroed (absent ≠ zero).
//   - unconfigured: no critical equipment configured is a configuration hole,
//     never good news — no checkmark, no success copy, amber not green.
//
// Visual system: elevation-gray tokens from [data-board-shell] (src/index.css),
// amber accent via --state-tint-warn, headline at the 64px 10-foot scale,
// tabular-nums on every figure, and LTR isolation (<bdi dir="ltr">) for clock
// times and counts inside the Hebrew-first layout.
import { Settings2, WifiOff } from "lucide-react";
import { t } from "@/lib/i18n";
import type { DisplayConnection } from "@/hooks/use-display-connection";
import type { DisplaySnapshot } from "@/types/safety-surfaces";

/**
 * Minute-granularity local clock time for the last successful poll — zero-padded
 * HH:mm via the same he-IL 24h formatter the board clock and formatSince use.
 * (Bare getHours() rendered "9:05" instead of "09:05".)
 */
export function formatLastGoodTime(lastSuccessAtMs: number): string {
  return new Date(lastSuccessAtMs).toLocaleTimeString("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function TakeoverFrame({
  kind,
  icon,
  headline,
  children,
}: {
  kind: string;
  icon: React.ReactNode;
  headline: string;
  children?: React.ReactNode;
}) {
  return (
    <section
      data-testid="board-takeover"
      data-kind={kind}
      className="flex h-full w-full flex-col items-center justify-center gap-8 px-12 py-16 text-center"
      style={{ color: "var(--board-text)" }}
    >
      <div
        aria-hidden="true"
        className="flex items-center justify-center rounded-full p-7"
        style={{
          color: "var(--state-tint-warn)",
          backgroundColor: "color-mix(in oklab, var(--state-tint-warn) 15%, var(--board-bg))",
        }}
      >
        {icon}
      </div>
      <h1 className="text-[64px] font-bold leading-tight" style={{ color: "var(--board-text)" }}>
        {headline}
      </h1>
      {children}
    </section>
  );
}

export function StaleTakeover({
  connection,
  lastSnapshot,
}: {
  connection: DisplayConnection;
  lastSnapshot: DisplaySnapshot | undefined;
}) {
  const headline = connection.state === "offline" ? t.board.stateOffline : t.board.stateStale;
  const overview = lastSnapshot?.commandBoard?.overview;
  return (
    <TakeoverFrame kind="stale" icon={<WifiOff size={96} strokeWidth={1.75} />} headline={headline}>
      {connection.lastSuccessAt != null ? (
        <p
          data-testid="board-lastgood"
          className="text-[32px] font-medium"
          style={{ color: "var(--board-text2)" }}
        >
          {t.board.lastGoodAt(formatLastGoodTime(connection.lastSuccessAt))}
        </p>
      ) : null}
      {overview ? (
        <div
          data-testid="board-lastknown"
          className="mt-4 flex flex-col items-center gap-3 rounded-2xl px-12 py-8"
          style={{ backgroundColor: "var(--board-card)" }}
        >
          <span
            className="text-[28px] font-semibold uppercase tracking-wide"
            style={{ color: "var(--board-text2)" }}
          >
            {t.board.lastKnown}
          </span>
          <span className="board-nums text-[56px] font-bold leading-none">
            <bdi dir="ltr">
              {overview.ready}/{overview.totalCritical}
            </bdi>
          </span>
        </div>
      ) : null}
    </TakeoverFrame>
  );
}

export function UnconfiguredTakeover() {
  return (
    <TakeoverFrame
      kind="unconfigured"
      icon={<Settings2 size={96} strokeWidth={1.75} />}
      headline={t.board.stateUnconfigured}
    >
      <p className="text-[32px] font-medium" style={{ color: "var(--board-text2)" }}>
        {t.board.stateUnconfiguredHint}
      </p>
    </TakeoverFrame>
  );
}
