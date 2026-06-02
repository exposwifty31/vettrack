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
import { formatRelativeTime } from "@/lib/utils";
import { t } from "@/lib/i18n";
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

  const paneVisibility = getDisplayPaneVisibility(snapshot);
  const notDeployableCount = snapshot.equipment.filter((e) => !e.isDeployable).length;
  const checkedOutCount = snapshot.equipment.filter((e) => e.heldBy).length;

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

      {checkedOutCount > 0 && (
        <span className="flex items-center gap-1 bg-sky-900/25 border border-sky-700/40 text-sky-200 rounded px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap">
          {checkedOutCount} יחידות בידי צוות
        </span>
      )}

      {notDeployableCount > 0 && (
        <span className="flex items-center gap-1 bg-amber-900/25 border border-amber-700/40 text-amber-200 rounded px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap">
          {notDeployableCount} לא מוכנות לפריסה
        </span>
      )}

      <span className="ms-auto flex items-center bg-white/5 border border-white/10 text-gray-400 rounded px-2.5 py-1 text-[11px] whitespace-nowrap">
        {snapshot.equipment.length} יחידות
      </span>
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
      {(hosp.overdueTaskCount ?? 0) > 0 && hosp.overdueTaskLabel && (
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

function deployableHint(eq: DisplaySnapshotEquipment): string | null {
  if (eq.isDeployable) return null;
  if (eq.usageState !== "available") return "בשימוש / לא זמין";
  if (eq.readinessState !== "ready") return "לא מוכן";
  if (eq.custodyState !== "docked") {
    if (eq.heldBy) return "בידי צוות";
    return "לא במעגן";
  }
  return null;
}

function EquipmentPane({ equipment }: { equipment: DisplaySnapshotEquipment[] }) {
  const sorted = [...equipment].sort((a, b) => {
    const aHeld = Boolean(a.heldBy);
    const bHeld = Boolean(b.heldBy);
    if (aHeld !== bHeld) return aHeld ? -1 : 1;
    if (a.isDeployable !== b.isDeployable) return a.isDeployable ? 1 : -1;
    return a.name.localeCompare(b.name, "he");
  });

  return (
    <div className="flex-1 p-4 overflow-auto" data-testid="ward-display-equipment-pane">
      <div className="text-[11px] font-bold tracking-widest uppercase text-gray-600 mb-3">
        ציוד · אחזקה ופריסה
      </div>
      <div
        className="hidden sm:grid gap-2 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-600 border-b border-[#1f2937] mb-1"
        style={{ gridTemplateColumns: "minmax(140px,1.4fr) minmax(100px,1fr) minmax(90px,0.9fr) minmax(120px,1.1fr) minmax(88px,0.7fr)" }}
      >
        <span>יחידה</span>
        <span>בידי</span>
        <span>צ׳ק-אין אחרון</span>
        <span>מיקום משוער</span>
        <span>פריסה</span>
      </div>
      <div className="space-y-2">
        {sorted.map((eq) => {
          const hint = deployableHint(eq);
          return (
            <div
              key={eq.id}
              data-testid={`ward-display-equipment-row-${eq.id}`}
              className="rounded-lg border border-[#1f2937] bg-[#121820] px-3 py-2.5 sm:grid sm:items-center sm:gap-2"
              style={{ gridTemplateColumns: "minmax(140px,1.4fr) minmax(100px,1fr) minmax(90px,0.9fr) minmax(120px,1.1fr) minmax(88px,0.7fr)" }}
            >
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-gray-200 truncate">{eq.name}</div>
                <div className="sm:hidden text-[10px] text-gray-500 mt-0.5">
                  {eq.probableLocation ?? "מיקום לא ידוע"}
                </div>
              </div>
              <div className="text-[12px] text-gray-300 truncate mt-1 sm:mt-0">
                <span className="sm:hidden text-gray-600 me-1">בידי:</span>
                {eq.heldBy ?? "—"}
              </div>
              <div className="text-[11px] text-gray-400 mt-1 sm:mt-0 tabular-nums">
                <span className="sm:hidden text-gray-600 me-1">צ׳ק-אין:</span>
                {eq.lastCheckInAt ? formatRelativeTime(eq.lastCheckInAt) : "לא דווח"}
              </div>
              <div className="text-[12px] text-gray-400 truncate mt-1 sm:mt-0">
                <span className="sm:hidden text-gray-600 me-1">מיקום:</span>
                {eq.probableLocation ?? "—"}
              </div>
              <div className="mt-2 sm:mt-0 flex flex-col items-start gap-0.5">
                <span
                  className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                    eq.isDeployable
                      ? "bg-green-900/35 text-green-300 border border-green-700/40"
                      : "bg-amber-900/30 text-amber-200 border border-amber-700/40"
                  }`}
                >
                  {eq.isDeployable ? "מוכן" : "לא מוכן"}
                </span>
                {hint ? <span className="text-[10px] text-gray-500">{hint}</span> : null}
              </div>
            </div>
          );
        })}
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
                {task.notes ?? task.taskType ?? "משימה"}
              </span>
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 bg-sky-900/20 text-sky-300">
                {task.taskType ?? "פרוצדורה"}
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
        {/* Column 1 — Equipment */}
        <div className="flex-1 p-5">
          <div className="text-[10px] font-bold tracking-[.1em] uppercase text-red-700/80 mb-3">
            {t.codeBlue.overlay.equipmentColumn}
          </div>
          {linkedEquipment.length > 0 ? (
            <div className="space-y-2">
              {linkedEquipment.map((eq) => (
                <div key={eq.id} className="text-[16px] font-bold text-white">
                  {eq.name}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-gray-500 text-[13px]">{t.codeBlue.noEquipmentInEvent}</div>
          )}
        </div>

        {/* Column 2 — Event timeline */}
        <div className="flex-1 p-5">
          <div className="text-[10px] font-bold tracking-[.1em] uppercase text-red-700/80 mb-3">
            {t.codeBlue.overlay.timelineColumn}
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

        {/* Column 3 — Status */}
        <div className="w-64 shrink-0 p-5">
          <div className="text-[10px] font-bold tracking-[.1em] uppercase text-red-700/80 mb-3">
            {t.codeBlue.overlay.sidebarColumn}
          </div>

          <div className="text-[10px] font-bold tracking-[.1em] uppercase text-red-700/80 mb-2">
            {t.codeBlue.overlay.crashCart}
          </div>
          <div className={`text-[12px] mb-4 ${session.preCheckPassed === false ? "text-red-400" : "text-green-400"}`}>
            {session.preCheckPassed === false
              ? `⚠ ${t.codeBlue.overlay.cartNotChecked}`
              : `✓ ${t.codeBlue.overlay.cartReady}`}
          </div>

          {minutesSincePush !== null && (
            <>
              <div className="text-[10px] font-bold tracking-[.1em] uppercase text-red-700/80 mb-2">
                {t.codeBlue.display.present}
              </div>
              <div className="text-[11px] text-gray-400">
                {t.codeBlue.overlay.pushSent}
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
      <CodeBlueOverlay session={snapshot.codeBlueSession} />
    );
  }

  const paneVisibility = getDisplayPaneVisibility(snapshot);

  return (
    <div className="min-h-screen bg-[#0d1117] text-gray-200 flex flex-col" dir="rtl">
      <AwarenessBar snapshot={snapshot} />
      <div className="flex flex-col flex-1 min-h-0">
        <EquipmentPane equipment={snapshot.equipment} />
        {paneVisibility.showUpcomingTasks && (
          <div className="shrink-0 border-t border-[#1f2937] max-h-[28vh] overflow-auto">
            <UpcomingTasksPane tasks={snapshot.upcomingTasks} currentTime={snapshot.currentTime} />
          </div>
        )}
      </div>
    </div>
  );
}
