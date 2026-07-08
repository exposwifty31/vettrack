// Read-only Code Blue emergency overlay for the Command Center board.
// Verbatim move from src/pages/display.tsx:464-597 (Phase 4 C1). All imports are
// @/-aliased, so this is byte-identical (no import-depth change). The live timer
// computes elapsed from the server clock (session.startedAt), never Date.now()
// at mount — do not simplify it.
import { useEffect, useState } from "react";
import { Bdi } from "@/components/ui/bdi";
import { t } from "@/lib/i18n";
import type { DisplaySnapshotCodeBlueSession } from "@/types/safety-surfaces";

export function CodeBlueOverlay({
  session,
}: {
  session: DisplaySnapshotCodeBlueSession;
}) {
  // Live timer — updates every second using server startedAt (not local clock)
  const [elapsedMs, setElapsedMs] = useState(
    () => Date.now() - new Date(session.startedAt).getTime(),
  );
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - new Date(session.startedAt).getTime());
    }, 1_000);
    return () => clearInterval(interval);
  }, [session.startedAt]);

  const minutes = Math.floor(elapsedMs / 60_000);
  const seconds = Math.floor((elapsedMs % 60_000) / 1_000);
  const timerStr = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  const staleThreshold = Date.now() - 30_000;
  const activePresence = session.presence.filter(
    (p) => new Date(p.lastSeenAt).getTime() > staleThreshold,
  );

  const minutesSincePush = session.pushSentAt
    ? Math.floor((Date.now() - new Date(session.pushSentAt).getTime()) / 60_000)
    : null;

  const linkedEquipment = session.linkedEquipment ?? [];
  const displayedLogs = session.logEntries.slice(-15);

  return (
    <div className="flex flex-col min-h-screen bg-emergency-bg" dir="rtl">
      {/* Pulsing red header */}
      <div className="flex items-center gap-4 px-6 py-4 bg-emergency-accent motion-safe:animate-pulse flex-wrap">
        <span className="vt-text-2xl font-black tracking-wider text-white">⚠ CODE BLUE</span>
        <span className="font-mono vt-text-xl font-bold text-white bg-black/25 px-3 py-1 rounded tabular-nums">
          {timerStr}
        </span>
        <span className="vt-text-sm text-white/85 ms-auto">
          {t.codeBlue.managerLabelShort}{" "}
          <Bdi>{session.managerUserName}</Bdi>
        </span>
        <div className="flex flex-wrap gap-1.5">
          {activePresence.map((p) => (
            <div
              key={p.userId}
              className="flex items-center gap-1.5 bg-emergency-accent/20 border border-emergency-accent/40 rounded-full px-3 py-0.5 vt-text-xs text-emergency-text"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emergency-accent motion-safe:animate-ping shrink-0" />
              {p.userName}
            </div>
          ))}
        </div>
      </div>

      {/* Three-column body */}
      <div className="flex flex-1 divide-x divide-emergency-accent/25 divide-x-reverse">
        {/* Column 1 — Equipment */}
        <div className="flex-1 p-5">
          <div className="vt-text-2xs font-bold tracking-[.1em] uppercase text-emergency-accent/80 mb-3">
            {t.codeBlue.overlay.equipmentColumn}
          </div>
          {linkedEquipment.length > 0 ? (
            <div className="space-y-2">
              {linkedEquipment.map((eq) => (
                <div key={eq.id} className="vt-text-body font-bold text-white">
                  <Bdi>{eq.name}</Bdi>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-emergency-text2 vt-text-sm">{t.codeBlue.noEquipmentInEvent}</div>
          )}
        </div>

        {/* Column 2 — Event timeline */}
        <div className="flex-1 p-5">
          <div className="vt-text-2xs font-bold tracking-[.1em] uppercase text-emergency-accent/80 mb-3">
            {t.codeBlue.overlay.timelineColumn}
          </div>
          <div className="space-y-2">
            {displayedLogs.map((entry, idx) => {
              const em = Math.floor(entry.elapsedMs / 60_000);
              const es = Math.floor((entry.elapsedMs % 60_000) / 1_000);
              const entryTime = `${String(em).padStart(2, "0")}:${String(es).padStart(2, "0")}`;
              return (
                <div key={`${entry.elapsedMs}-${entry.label}-${idx}`} className="flex gap-2 vt-text-xs">
                  <span className="text-emergency-accent tabular-nums min-w-[42px] vt-text-2xs shrink-0">
                    {entryTime}
                  </span>
                  <span className="flex-1 text-emergency-text">{entry.label}</span>
                  <span className="text-emergency-text2 vt-text-2xs shrink-0"><Bdi>{entry.loggedByName}</Bdi></span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Column 3 — Status */}
        <div className="w-64 shrink-0 p-5">
          <div className="vt-text-2xs font-bold tracking-[.1em] uppercase text-emergency-accent/80 mb-3">
            {t.codeBlue.overlay.sidebarColumn}
          </div>

          <div className="vt-text-2xs font-bold tracking-[.1em] uppercase text-emergency-accent/80 mb-2">
            {t.codeBlue.overlay.crashCart}
          </div>
          <div className={`vt-text-xs mb-4 ${session.preCheckPassed === false ? "text-emergency-accent" : "text-[rgb(var(--sys-green))]"}`}>
            {session.preCheckPassed === false
              ? `⚠ ${t.codeBlue.overlay.cartNotChecked}`
              : `✓ ${t.codeBlue.overlay.cartReady}`}
          </div>

          {minutesSincePush !== null && (
            <>
              <div className="vt-text-2xs font-bold tracking-[.1em] uppercase text-emergency-accent/80 mb-2">
                {t.codeBlue.display.present}
              </div>
              <div className="vt-text-xs text-emergency-text2">
                {t.codeBlue.overlay.pushSent}
                <br />
                <span className="text-emergency-text2 vt-text-2xs">
                  {t.codeBlue.overlay.pushSentMinutesAgo(minutesSincePush)}
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
