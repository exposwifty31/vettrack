// src/pages/display.tsx
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  connectRealtime,
  disconnectRealtime,
  EventIngestor,
  publishBuildTagGossip,
  publishCodeBlueSeenGossip,
} from "@/lib/realtime";
import { useDisplaySnapshot } from "@/hooks/useDisplaySnapshot";
import { useKioskWakeLock } from "@/hooks/useKioskWakeLock";
import { useDisplayHeartbeat } from "@/hooks/useDisplayHeartbeat";
import { useRealtimeReconciliation } from "@/hooks/useRealtimeReconciliation";
import { useCodeBlueKeepaliveReconciliation } from "@/hooks/useCodeBlueKeepaliveReconciliation";
import type {
  DisplaySnapshot,
  DisplaySnapshotHospitalization,
  DisplaySnapshotEquipment,
  DisplaySnapshotTask,
  DisplaySnapshotCodeBlueSession,
  HospitalizationStatus,
} from "@/types";

// ── Status lookup tables ────────────────────────────────────────────────────

const STATUS_ORDER: Record<HospitalizationStatus, number> = {
  critical: 0,
  observation: 1,
  admitted: 2,
  recovering: 3,
  discharged: 4,
  deceased: 5,
};

const STATUS_LABELS_HE: Record<HospitalizationStatus, string> = {
  critical: "קריטי",
  observation: "תצפית",
  admitted: "מאושפז",
  recovering: "התאוששות",
  discharged: "שוחרר",
  deceased: "נפטר",
};

const STATUS_CARD: Record<HospitalizationStatus, string> = {
  critical: "bg-red-950/40 border-red-700/50",
  observation: "bg-amber-950/30 border-amber-700/40",
  admitted: "bg-indigo-950/30 border-indigo-600/30",
  recovering: "bg-green-950/20 border-green-700/30",
  discharged: "bg-white/5 border-white/10",
  deceased: "bg-white/5 border-white/10",
};

const STATUS_BAR: Record<HospitalizationStatus, string> = {
  critical: "bg-red-600",
  observation: "bg-amber-600",
  admitted: "bg-indigo-500",
  recovering: "bg-green-600",
  discharged: "bg-gray-600",
  deceased: "bg-gray-600",
};

const STATUS_BADGE: Record<HospitalizationStatus, string> = {
  critical: "bg-red-600 text-white",
  observation: "bg-amber-600 text-white",
  admitted: "bg-indigo-500 text-white",
  recovering: "bg-green-600 text-white",
  discharged: "bg-gray-600 text-white",
  deceased: "bg-gray-700 text-white",
};

const SHIFT_ROLE_LABELS: Record<string, string> = {
  admin: "מנהל",
  technician: "טכנאי",
  senior_technician: "טכנאי בכיר",
};

/** F1 — data-driven pane visibility for Ward Display (equipment-only pilots). */
export function getDisplayPaneVisibility(
  snapshot: Pick<
    DisplaySnapshot,
    "hospitalizations" | "upcomingTasks" | "crashCartStatus"
  >,
): {
  showCrashCartPill: boolean;
  showHospitalizationCount: boolean;
  showPatientGrid: boolean;
  showUpcomingTasks: boolean;
} {
  return {
    showCrashCartPill: snapshot.crashCartStatus !== null,
    showHospitalizationCount: snapshot.hospitalizations.length > 0,
    showPatientGrid: snapshot.hospitalizations.length > 0,
    showUpcomingTasks: snapshot.upcomingTasks.length > 0,
  };
}

// ── AwarenessBar ─────────────────────────────────────────────────────────────

function AwarenessBar({ snapshot }: { snapshot: DisplaySnapshot }) {
  const now = new Date(snapshot.currentTime);
  const timeStr = now.toLocaleTimeString("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const cart = snapshot.crashCartStatus;
  const cartCheckedAgoMs = cart
    ? now.getTime() - new Date(cart.lastCheckedAt).getTime()
    : null;
  const cartOk =
    cart !== null && cartCheckedAgoMs !== null && cartCheckedAgoMs < 24 * 3_600_000;
  const cartAgeLabel =
    cartCheckedAgoMs !== null
      ? cartCheckedAgoMs < 3_600_000
        ? `${Math.max(1, Math.round(cartCheckedAgoMs / 60_000))} דק׳`
        : `${Math.round(cartCheckedAgoMs / 3_600_000)} שע׳`
      : null;

  const firstOverdue = snapshot.hospitalizations.find((h) => h.overdueTaskCount > 0);
  const extraOverdue = snapshot.totalOverdueCount > 1 ? snapshot.totalOverdueCount - 1 : 0;
  const paneVisibility = getDisplayPaneVisibility(snapshot);

  return (
    <div className="flex items-center gap-4 px-4 py-2 bg-[#141922] border-b border-[#1e2740] text-sm flex-wrap">
      <span className="font-mono text-xl font-bold text-white tabular-nums min-w-[52px]">
        {timeStr}
      </span>
      <div className="w-px h-5 bg-[#2d3748] shrink-0" />

      <div className="flex gap-2 flex-wrap">
        {snapshot.currentShift.map((s) => (
          <div
            key={`${s.employeeName}-${s.role}`}
            className="flex items-center gap-1.5 bg-[#1e2740] border border-[#2d3d5c] rounded-full px-3 py-0.5 text-[11px] text-blue-300"
          >
            <span>{s.employeeName}</span>
            <span className="text-gray-500 text-[10px]">
              {SHIFT_ROLE_LABELS[s.role] ?? s.role}
            </span>
          </div>
        ))}
      </div>

      <div className="w-px h-5 bg-[#2d3748] shrink-0" />

      {paneVisibility.showCrashCartPill &&
        cart &&
        (cartOk ? (
          <span className="flex items-center gap-1 bg-green-900/30 border border-green-700/40 text-green-300 rounded px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap">
            ✓ עגלה נבדקה · {cartAgeLabel}
          </span>
        ) : (
          <span
            data-testid="ward-display-crash-cart-warning"
            className="flex items-center gap-1 bg-amber-900/20 border border-amber-700/40 text-yellow-300 rounded px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap"
          >
            ⚠ עגלה לא נבדקה היום
          </span>
        ))}

      {snapshot.activeAlertCount > 0 && (
        <span className="flex items-center gap-1 bg-amber-900/20 border border-amber-700/40 text-yellow-300 rounded px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap">
          ⚠ {snapshot.activeAlertCount} התראות
        </span>
      )}

      {snapshot.totalOverdueCount > 0 && firstOverdue && (
        <span className="flex items-center gap-1 bg-red-900/30 border border-red-600/60 text-red-300 rounded px-2.5 py-1 text-[11px] font-semibold animate-pulse whitespace-nowrap">
          💊 תרופה באיחור — {firstOverdue.animal.name}
          {extraOverdue > 0 && ` ועוד ${extraOverdue}`}
        </span>
      )}

      {paneVisibility.showHospitalizationCount && (
        <span className="ms-auto flex items-center bg-white/5 border border-white/10 text-gray-400 rounded px-2.5 py-1 text-[11px] whitespace-nowrap">
          {snapshot.hospitalizations.length} מאושפזים
        </span>
      )}
    </div>
  );
}

// ── PatientCard ───────────────────────────────────────────────────────────────

function PatientCard({ hosp }: { hosp: DisplaySnapshotHospitalization }) {
  const { animal } = hosp;
  const statusKey = hosp.status as HospitalizationStatus;
  const meta = [animal.species, animal.breed, animal.weightKg ? `${animal.weightKg} ק״ג` : null]
    .filter(Boolean)
    .join(" · ");
  const location = [hosp.ward, hosp.bay ? `מיטה ${hosp.bay}` : null].filter(Boolean).join(" · ");

  return (
    <div className={`rounded-lg p-3 border ${STATUS_CARD[statusKey] ?? "bg-white/5 border-white/10"}`}>
      <div className={`h-0.5 rounded mb-3 ${STATUS_BAR[statusKey] ?? "bg-gray-600"}`} />
      <div className="flex flex-wrap gap-1 mb-2">
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_BADGE[statusKey] ?? "bg-gray-600 text-white"}`}>
          {STATUS_LABELS_HE[statusKey] ?? hosp.status}
        </span>
        {hosp.status === "critical" && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-950 border border-red-600 text-red-300">
            CPR Risk
          </span>
        )}
      </div>
      <div className="text-[15px] font-bold text-white mb-0.5">{animal.name}</div>
      {meta && <div className="text-[11px] text-gray-500 mb-2">{meta}</div>}
      {location && <div className="text-[11px] text-gray-400">{location}</div>}
      {hosp.admittingVetName && (
        <div className="text-[11px] text-gray-500 mt-0.5">{hosp.admittingVetName}</div>
      )}
      {hosp.overdueTaskCount > 0 && hosp.overdueTaskLabel && (
        <div className="overdue-alert mt-2 rounded px-2 py-1.5 text-[10px] font-semibold text-red-300 border border-red-600/60 bg-red-950/30 animate-pulse">
          💊 {hosp.overdueTaskLabel}
        </div>
      )}
    </div>
  );
}

// ── PatientGrid ───────────────────────────────────────────────────────────────

function PatientGrid({
  hospitalizations,
}: {
  hospitalizations: DisplaySnapshotHospitalization[];
}) {
  const sorted = [...hospitalizations].sort((a, b) => {
    const orderDiff =
      (STATUS_ORDER[a.status as HospitalizationStatus] ?? 99) -
      (STATUS_ORDER[b.status as HospitalizationStatus] ?? 99);
    if (orderDiff !== 0) return orderDiff;
    return new Date(a.admittedAt).getTime() - new Date(b.admittedAt).getTime();
  });

  return (
    <div className="p-4 flex-1" data-testid="ward-display-patient-grid">
      <div className="text-[11px] font-bold tracking-widest uppercase text-gray-600 mb-3">
        מטופלים מאושפזים
      </div>
      <div
        className="grid gap-2.5"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}
      >
        {sorted.map((h) => (
          <PatientCard key={h.id} hosp={h} />
        ))}
      </div>
    </div>
  );
}

// ── EquipmentPane ─────────────────────────────────────────────────────────────

const EQ_STATUS_LABELS: Record<string, string> = {
  ok: "פנוי",
  sterilized: "פנוי",
  issue: "תקלה",
  critical: "קריטי",
  needs_attention: "דורש טיפול",
  maintenance: "תחזוקה",
};

const EQ_STATUS_CLASSES: Record<string, string> = {
  ok: "bg-indigo-900/20 text-indigo-300",
  sterilized: "bg-indigo-900/20 text-indigo-300",
  issue: "bg-red-900/25 text-red-300",
  critical: "bg-red-900/25 text-red-300",
  needs_attention: "bg-amber-900/20 text-yellow-300",
  maintenance: "bg-red-900/25 text-red-300",
};

function EquipmentPane({ equipment }: { equipment: DisplaySnapshotEquipment[] }) {
  const sorted = [...equipment].sort((a, b) => {
    if (a.inUse !== b.inUse) return a.inUse ? -1 : 1;
    return a.name.localeCompare(b.name, "he");
  });

  return (
    <div className="p-4 border-b border-[#1f2937]" data-testid="ward-display-equipment-pane">
      <div className="text-[11px] font-bold tracking-widest uppercase text-gray-600 mb-3">
        ציוד · מיקום ושימוש
      </div>
      <div>
        {sorted.map((eq) => (
          <div
            key={eq.id}
            className="flex items-start justify-between py-1.5 border-b border-[#1a1f2b] last:border-0"
          >
            <div className="min-w-0 me-2">
              <div className="text-[12px] text-gray-300 truncate">{eq.name}</div>
              <div className="text-[10px] text-gray-500 truncate">
                {eq.location ?? "—"}
              </div>
            </div>
            <span
              className={`text-[11px] font-semibold px-2 py-0.5 rounded shrink-0 ${
                eq.inUse
                  ? "bg-green-900/30 text-green-300"
                  : (EQ_STATUS_CLASSES[eq.status] ?? "bg-white/5 text-gray-400")
              }`}
            >
              {eq.inUse ? "בשימוש" : (EQ_STATUS_LABELS[eq.status] ?? eq.status)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── UpcomingTasksPane ─────────────────────────────────────────────────────────

function UpcomingTasksPane({
  tasks,
  currentTime,
}: {
  tasks: DisplaySnapshotTask[];
  currentTime: string;
}) {
  const now = new Date(currentTime);
  const displayed = tasks.slice(0, 6);
  const overflow = tasks.length - displayed.length;

  return (
    <div className="p-4" data-testid="ward-display-upcoming-tasks">
      <div className="text-[11px] font-bold tracking-widest uppercase text-gray-600 mb-3">
        פרוצדורות קרובות · 2 שע׳
      </div>
      <div>
        {displayed.map((task) => {
          const taskTime = new Date(task.startTime);
          const minutesUntil = Math.round((taskTime.getTime() - now.getTime()) / 60_000);
          const soon = minutesUntil <= 30;
          const timeLabel = taskTime.toLocaleTimeString("he-IL", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          });
          const isMed = task.taskType === "medication";
          return (
            <div
              key={task.id}
              className="flex items-center gap-2 py-1.5 border-b border-[#1a1f2b] last:border-0 text-[12px]"
            >
              <span
                className={`min-w-[38px] tabular-nums ${
                  soon ? "text-yellow-300 font-bold" : "text-gray-500"
                }`}
              >
                {timeLabel}
              </span>
              <span className="flex-1 text-gray-300 truncate">
                {task.notes ?? task.taskType ?? "משימה"} — {task.animalName}
              </span>
              <span
                className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${
                  isMed
                    ? "bg-violet-900/30 text-violet-300"
                    : "bg-sky-900/20 text-sky-300"
                }`}
              >
                {isMed ? "תרופה" : "פרוצדורה"}
              </span>
            </div>
          );
        })}
        {overflow > 0 && (
          <div className="text-[11px] text-gray-600 py-1">+{overflow} נוספים</div>
        )}
      </div>
    </div>
  );
}

// ── CodeBlueOverlay ───────────────────────────────────────────────────────────

function CodeBlueOverlay({
  session,
  hospitalizations,
}: {
  session: DisplaySnapshotCodeBlueSession;
  hospitalizations: DisplaySnapshotHospitalization[];
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

  const attachedEquipment = session.logEntries.filter((e) => e.category === "equipment");
  // Show last 15 entries — enough to fill the column without scroll
  const displayedLogs = session.logEntries.slice(-15);

  const remaining = hospitalizations.filter(
    (h) => !session.patientId || h.animalId !== session.patientId,
  );

  return (
    <div className="flex flex-col min-h-screen bg-[#0d0505]" dir="rtl">
      {/* Pulsing red header */}
      <div className="flex items-center gap-4 px-6 py-4 bg-red-600 animate-pulse flex-wrap">
        <span className="text-2xl font-black tracking-wider text-white">⚠ CODE BLUE</span>
        <span className="font-mono text-[22px] font-bold text-white bg-black/25 px-3 py-1 rounded tabular-nums">
          {timerStr}
        </span>
        <span className="text-[14px] text-white/85 ms-auto">
          מנהל הפצה: {session.managerUserName}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {activePresence.map((p) => (
            <div
              key={p.userId}
              className="flex items-center gap-1.5 bg-red-900/40 border border-red-600/40 rounded-full px-3 py-0.5 text-[11px] text-red-200"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-ping shrink-0" />
              {p.userName}
            </div>
          ))}
        </div>
      </div>

      {/* Three-column body */}
      <div className="flex flex-1 divide-x divide-red-900/30 divide-x-reverse">
        {/* Column 1 — Patient */}
        <div className="flex-1 p-5">
          <div className="text-[10px] font-bold tracking-[.1em] uppercase text-red-700/80 mb-3">
            מטופל
          </div>
          {session.patientName ? (
            <>
              <div className="text-[20px] font-bold text-white mb-1">{session.patientName}</div>
              <div className="text-[13px] text-red-200 leading-loose">
                {[
                  session.patientSpecies,
                  session.patientWeight ? `${session.patientWeight} ק״ג` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                {(session.ward || session.bay) && (
                  <>
                    <br />
                    {[session.ward, session.bay ? `מיטה ${session.bay}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </>
                )}
              </div>
              <div className="mt-3 text-red-500 font-bold text-[13px]">⚠ CPR Risk</div>
            </>
          ) : (
            <div className="text-gray-500 text-[13px]">מטופל לא צוין</div>
          )}
          {attachedEquipment.length > 0 && (
            <div className="mt-5">
              <div className="text-[10px] font-bold tracking-[.08em] uppercase text-red-700/60 mb-2">
                ציוד מחובר
              </div>
              {attachedEquipment.map((e) => (
                <div key={e.label} className="text-[12px] text-red-200 mb-1">
                  {e.label}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Column 2 — Event timeline */}
        <div className="flex-1 p-5">
          <div className="text-[10px] font-bold tracking-[.1em] uppercase text-red-700/80 mb-3">
            יומן אירוע
          </div>
          <div className="space-y-2">
            {displayedLogs.map((entry, idx) => {
              const em = Math.floor(entry.elapsedMs / 60_000);
              const es = Math.floor((entry.elapsedMs % 60_000) / 1_000);
              const entryTime = `${String(em).padStart(2, "0")}:${String(es).padStart(2, "0")}`;
              return (
                <div key={`${entry.elapsedMs}-${entry.label}-${idx}`} className="flex gap-2 text-[12px]">
                  <span className="text-red-500 tabular-nums min-w-[42px] text-[11px] shrink-0">
                    {entryTime}
                  </span>
                  <span className="flex-1 text-red-200">{entry.label}</span>
                  <span className="text-gray-600 text-[10px] shrink-0">{entry.loggedByName}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Column 3 — Sidebar */}
        <div className="w-64 shrink-0 p-5">
          <div className="text-[10px] font-bold tracking-[.1em] uppercase text-red-700/80 mb-3">
            שאר המאושפזים
          </div>
          <div className="space-y-1 mb-5">
            {remaining.map((h) => (
              <div key={h.id} className="text-[12px] text-gray-400">
                {h.animal.name} · {h.ward} {h.bay} ·{" "}
                <span
                  className={
                    h.status === "critical"
                      ? "text-red-400"
                      : h.status === "observation"
                        ? "text-amber-400"
                        : "text-green-400"
                  }
                >
                  {STATUS_LABELS_HE[h.status as HospitalizationStatus] ?? h.status}
                </span>
              </div>
            ))}
          </div>

          <div className="text-[10px] font-bold tracking-[.1em] uppercase text-red-700/80 mb-2">
            עגלת חירום
          </div>
          <div className={`text-[12px] mb-4 ${session.preCheckPassed === false ? "text-red-400" : "text-green-400"}`}>
            {session.preCheckPassed === false ? "⚠ לא נבדקה" : "✓ זמינה"}
          </div>

          {minutesSincePush !== null && (
            <>
              <div className="text-[10px] font-bold tracking-[.1em] uppercase text-red-700/80 mb-2">
                הודעות
              </div>
              <div className="text-[11px] text-gray-400">
                📱 Push נשלח לכל הצוות
                <br />
                <span className="text-gray-600 text-[10px]">לפני {minutesSincePush} דק׳</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── WardDisplayPage ───────────────────────────────────────────────────────────

export default function WardDisplayPage() {
  const qc = useQueryClient();
  const realtimeIngestor = useMemo(() => new EventIngestor(qc), [qc]);

  // Phase 9 PR 9.2 — kiosk-only wake-lock + operational heartbeat.
  // `?kiosk=1` opts a Department Display surface into TV-grade behavior:
  // screen wake-lock with bounded reacquire discipline. Non-kiosk views of
  // /display (e.g. an operator's tab) do not request the wake-lock.
  const kioskMode = useMemo(() => {
    if (typeof window === "undefined") return false;
    try {
      return new URL(window.location.href).searchParams.get("kiosk") === "1";
    } catch {
      return false;
    }
  }, []);

  useKioskWakeLock(kioskMode);

  // Phase 9 PR 9.3 — visibility / pageshow / online / resume reconciliation.
  // Centralized so display, ER, and other realtime-consuming pages share one
  // implementation and never drift apart.
  useRealtimeReconciliation({ queryClient: qc, ingestor: realtimeIngestor });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await realtimeIngestor.replayHttpCatchUpAfter(realtimeIngestor.getLastAppliedEventId());
      } catch {
        // Replay is best-effort; SSE + snapshot queries still converge.
      }
      if (!cancelled) {
        connectRealtime(() => {}, { queryClient: qc, ingestor: realtimeIngestor });
      }
    })();
    return () => {
      cancelled = true;
      disconnectRealtime({ ingestor: realtimeIngestor });
      realtimeIngestor.dispose();
    };
  }, [qc, realtimeIngestor]);

  const snapshot = useDisplaySnapshot();

  // Phase 9 PR 9.2 — heartbeat (operational-only). Always runs while the
  // display surface is mounted; never gates rendering or any clinical path.
  useDisplayHeartbeat({ kioskMode });

  // Phase 9 PR 9.4 — Code Blue keepalive reconciliation. Compares the local
  // snapshot's active session id against the server's keepalive. After a
  // 5 s grace window on persistent disagreement, forces a snapshot refetch.
  // The overlay is never cleared locally — server snapshots drive overlay
  // visibility.
  useCodeBlueKeepaliveReconciliation({
    queryClient: qc,
    getLocalActiveSessionId: () => snapshot?.codeBlueSession?.id ?? null,
  });

  // Phase 9 PR 9.6 — BroadcastChannel split-version gossip.
  // On focus, gossip this tab's build tag so other tabs detect divergence
  // and surface the existing update banner once. Best-effort, no leader
  // election, no consensus.
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onFocus(): void {
      publishBuildTagGossip();
    }
    window.addEventListener("focus", onFocus);
    publishBuildTagGossip();
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // Phase 9 PR 9.6 — Code Blue split-brain gossip. When the active CB
  // session id this tab is rendering changes, gossip it so peer tabs can
  // re-establish baseline if they disagree.
  //
  // Skip the publish while `snapshot` is still loading on first mount:
  // the initial render produces `localCbId = null` before this tab
  // actually knows the server's CB state. Publishing a premature `null`
  // would wake peer tabs during an active emergency and have them all
  // re-fetch baseline based on this tab's not-yet-loaded view.
  const snapshotLoaded = snapshot !== undefined;
  const localCbId = snapshot?.codeBlueSession?.id ?? null;
  useEffect(() => {
    if (!snapshotLoaded) return;
    publishCodeBlueSeenGossip(localCbId);
  }, [snapshotLoaded, localCbId]);

  if (!snapshot) {
    return (
      <div className="min-h-screen bg-[#0d1117] flex items-center justify-center">
        <div className="text-gray-500 text-sm">טוען...</div>
      </div>
    );
  }

  if (snapshot.codeBlueSession) {
    return (
      <CodeBlueOverlay
        session={snapshot.codeBlueSession}
        hospitalizations={snapshot.hospitalizations}
      />
    );
  }

  const paneVisibility = getDisplayPaneVisibility(snapshot);

  return (
    <div className="min-h-screen bg-[#0d1117] text-gray-200 flex flex-col" dir="rtl">
      <AwarenessBar snapshot={snapshot} />
      <div className="flex flex-col sm:flex-row flex-1 min-h-0">
        {paneVisibility.showPatientGrid && (
          <div className="flex-1 min-w-0 overflow-auto">
            <PatientGrid hospitalizations={snapshot.hospitalizations} />
          </div>
        )}
        <div className="w-full sm:w-[420px] shrink-0 border-t sm:border-t-0 sm:border-r border-[#1f2937] flex flex-col overflow-auto">
          <EquipmentPane equipment={snapshot.equipment} />
          {paneVisibility.showUpcomingTasks && (
            <UpcomingTasksPane tasks={snapshot.upcomingTasks} currentTime={snapshot.currentTime} />
          )}
        </div>
      </div>
    </div>
  );
}
