// src/pages/code-blue.tsx
import { useState, useEffect, useRef } from "react";
import { useLocation, useSearch } from "wouter";
import { AlertTriangle, Shield, Zap } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { authFetch } from "@/lib/auth-fetch";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { clearCodeBlueSessionCache, useCodeBlueSession } from "@/hooks/useCodeBlueSession";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";
import { toast } from "sonner";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60).toString().padStart(2, "0");
  const s = (totalSec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function useElapsed(startedAt: string | null): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const tick = () => setElapsed(Date.now() - new Date(startedAt).getTime());
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [startedAt]);
  return elapsed;
}

// ─── CPR Sound Alert ─────────────────────────────────────────────────────────

function useCprCycleBeep(elapsedMs: number, active: boolean) {
  const lastCycleRef = useRef(-1);
  useEffect(() => {
    if (!active) return;
    const cycle = Math.floor(elapsedMs / 120000);
    if (cycle > 0 && cycle !== lastCycleRef.current) {
      lastCycleRef.current = cycle;
      try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        osc.start();
        osc.stop(ctx.currentTime + 0.4);
      } catch {
        // AudioContext not available (e.g. in tests)
      }
    }
  }, [elapsedMs, active]);
}

// ─── Drug dose calculator ─────────────────────────────────────────────────────

// Drug catalog: clinical data, NOT localizable copy. Drug names
// (English) match the formulary table's `name` field convention; units
// (mg, units) are also data, not UI text. Per Phase 6 PR 6.7 follow-up
// correction (CORRECTION 1): this catalog is owned by code-blue.tsx
// inline rather than the locale dict, because clinical drug
// identifiers belong with the data, not with i18n copy. The formulary
// schema is the canonical source for these drugs' English names
// (`shared/drug-formulary-seed.ts`); a future schema enhancement could
// add localized name columns, at which point this array could be
// replaced by a formulary query without further locale-dict changes.
const DRUGS = [
  { key: "epi",         label: "Epinephrine", dosePerKg: 0.01, unit: "mg",    category: "drug" as const },
  { key: "atropine",    label: "Atropine",    dosePerKg: 0.04, unit: "mg",    category: "drug" as const },
  { key: "vasopressin", label: "Vasopressin", dosePerKg: 0.8,  unit: "units", category: "drug" as const },
];

// ─── Manager picker (for non-eligible users) ─────────────────────────────────

function ManagerPicker({ onSelect }: { onSelect: (id: string, name: string) => void }) {
  const { userId } = useAuth();
  const managersQ = useQuery<Array<{ id: string; name: string; role: string }>>({
    queryKey: ["/api/users/managers"],
    queryFn: async () => {
      const res = await authFetch("/api/users/managers");
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      return data.managers ?? [];
    },
    enabled: !!userId,
  });

  return (
    <div className="flex flex-col gap-2">
      {managersQ.isPending && <p className="text-xs text-zinc-500">{t.codeBlue.loadingManagers}</p>}
      {managersQ.data?.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => onSelect(m.id, m.name)}
          className="p-2 rounded border border-zinc-700 bg-zinc-800 text-sm text-zinc-200 text-right hover:bg-zinc-700"
        >
          {m.name} ({m.role === "admin" ? t.codeBlue.role.admin : t.codeBlue.role.vet})
        </button>
      ))}
      {managersQ.data?.length === 0 && (
        <p className="text-xs text-red-400">{t.codeBlue.noManagersAvailable}</p>
      )}
    </div>
  );
}

// ─── Pre-check gate ──────────────────────────────────────────────────────────

function PreCheckGate({ onStart }: { onStart: (passed: boolean, manager: { id: string; name: string }) => void }) {
  const { userId, role, name } = useAuth();
  const isEligibleManager = role === "vet" || role === "admin";
  // Built per-render so a runtime locale switch
  // (`setStoredLocale` → `refreshTranslations`) reflows the labels.
  // Module-level capture froze the labels at first import (Codex P2
  // finding on PR #338).
  const QUICK_CHECK_ITEMS = [
    { key: "defib",  label: t.codeBlue.preCheck.defib },
    { key: "o2",     label: t.codeBlue.preCheck.o2 },
    { key: "iv",     label: t.codeBlue.preCheck.iv },
    { key: "drugs",  label: t.codeBlue.preCheck.drugs },
    { key: "ambu",   label: t.codeBlue.preCheck.ambu },
  ];
  const [checked, setChecked] = useState<Record<string, boolean>>(
    Object.fromEntries(QUICK_CHECK_ITEMS.map((i) => [i.key, false])),
  );
  const [managerId, setManagerId] = useState(isEligibleManager ? (userId ?? "") : "");
  const [managerName, setManagerName] = useState(isEligibleManager ? (name ?? "") : "");


  const allChecked = QUICK_CHECK_ITEMS.every((i) => checked[i.key]);

  const toggle = (key: string) => setChecked((p) => ({ ...p, [key]: !p[key] }));

  const handleStart = (passed: boolean) => {
    if (!managerId || !managerName) return;
    onStart(passed, { id: managerId, name: managerName });
  };

  return (
    <div className="min-h-screen bg-zinc-950 p-4 max-w-md mx-auto" dir="rtl">
      <div className="flex items-center gap-2 mb-6 text-red-400">
        <AlertTriangle className="h-6 w-6" />
        <h1 className="text-xl font-bold">{t.codeBlue.openTitle}</h1>
      </div>

      {/* Manager designation */}
      <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 mb-4">
        <h2 className="text-sm font-semibold text-zinc-400 mb-3 flex items-center gap-2">
          <Shield className="h-4 w-4" /> {t.codeBlue.managerLabel}
        </h2>
        <p className="text-xs text-zinc-500 mb-3">
          {t.codeBlue.managerInstruction}
        </p>
        {isEligibleManager ? (
          <div className="rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm text-zinc-200">
            {name} {t.codeBlue.you}
          </div>
        ) : (
          <>
            <ManagerPicker onSelect={(id, n) => { setManagerId(id); setManagerName(n); }} />
            {managerId && (
              <div className="mt-2 text-xs text-green-400">{t.codeBlue.selectedManager(managerName)}</div>
            )}
          </>
        )}
      </div>

      {/* Quick pre-check */}
      <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 mb-4">
        <h2 className="text-sm font-semibold text-zinc-400 mb-3">{t.codeBlue.preCheck.title}</h2>
        <div className="flex flex-col gap-2">
          {QUICK_CHECK_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => toggle(item.key)}
              className={cn(
                "flex items-center gap-3 p-2 rounded border text-sm text-right transition-colors",
                checked[item.key]
                  ? "border-green-500/40 bg-green-500/10 text-green-300"
                  : "border-zinc-700 bg-zinc-800 text-zinc-300",
              )}
            >
              <span className={cn("h-4 w-4 rounded-full border-2 shrink-0", checked[item.key] ? "border-green-500 bg-green-500" : "border-zinc-500")} />
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <Button
        className="w-full bg-red-700 hover:bg-red-600 text-white font-bold"
        disabled={!managerId}
        onClick={() => handleStart(allChecked)}
      >
        {t.codeBlue.openButton}
      </Button>
      {!allChecked && (
        <button
          type="button"
          className="w-full mt-2 text-xs text-zinc-500 hover:text-zinc-400"
          onClick={() => handleStart(false)}
        >
          {t.codeBlue.proceedWithoutFullCheck}
        </button>
      )}
    </div>
  );
}

// ─── Outcome modal ───────────────────────────────────────────────────────────

function OutcomeModal({ onClose }: { onClose: (outcome: string) => void }) {
  // Built per-render so a runtime locale switch reflows the labels.
  // Module-level capture froze the labels at first import (Codex P2
  // finding on PR #338).
  const OUTCOMES = [
    { value: "rosc",        label: t.codeBlue.outcome.rosc },
    { value: "transferred", label: t.codeBlue.outcome.transferred },
    { value: "ongoing",     label: t.codeBlue.outcome.ongoing },
    { value: "died",        label: t.codeBlue.outcome.died },
  ];
  return (
    <div className="fixed inset-0 bg-black/70 flex items-end justify-center z-50 p-4" dir="rtl">
      <div className="w-full max-w-md bg-zinc-900 rounded-t-2xl border border-zinc-700 p-4">
        <h2 className="text-base font-bold text-white mb-4 text-center">{t.codeBlue.selectOutcome}</h2>
        <div className="flex flex-col gap-2">
          {OUTCOMES.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => onClose(o.value)}
              className={cn(
                "p-3 rounded-lg border text-sm font-semibold transition-colors text-right",
                o.value === "died"
                  ? "border-red-800 bg-red-950/50 text-red-300 hover:bg-red-900/50"
                  : "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
        <button type="button" className="w-full mt-3 text-xs text-zinc-500" onClick={() => onClose("")}>{t.common.cancel}</button>
      </div>
    </div>
  );
}

// ─── Equipment picker ─────────────────────────────────────────────────────────

interface EquipmentItem { id: string; name: string; }

function EquipmentPicker({ onSelect, onClose }: { onSelect: (item: EquipmentItem) => void; onClose: () => void }) {
  const { userId } = useAuth();
  const equipQ = useQuery<EquipmentItem[]>({
    queryKey: ["/api/equipment", "active"],
    queryFn: async () => {
      const res = await authFetch("/api/equipment?status=ok&limit=30");
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      return (data.items ?? data) as EquipmentItem[];
    },
    enabled: !!userId,
  });
  return (
    <div className="fixed inset-0 bg-black/70 flex items-end justify-center z-50 p-4" dir="rtl">
      <div className="w-full max-w-md bg-zinc-900 rounded-t-2xl border border-zinc-700 p-4">
        <h2 className="text-base font-bold text-white mb-4">{t.codeBlue.selectEquipment}</h2>
        <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
          {equipQ.data?.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => { onSelect(item); onClose(); }}
              className="p-3 rounded-lg border border-zinc-700 bg-zinc-800 text-sm text-zinc-200 text-right hover:bg-zinc-700"
            >
              {item.name}
            </button>
          ))}
          {equipQ.data?.length === 0 && <p className="text-zinc-500 text-sm">{t.codeBlue.noEquipmentAvailable}</p>}
        </div>
        <button type="button" className="w-full mt-3 text-xs text-zinc-500" onClick={onClose}>{t.common.cancel}</button>
      </div>
    </div>
  );
}

// ─── Active session view ──────────────────────────────────────────────────────

function ActiveSession() {
  const { userId } = useAuth();
  const { session, logEntries, presence, cartStatus, logEntry } = useCodeBlueSession();
  // elapsed is derived from session.startedAt (server timestamp)
  const elapsed = useElapsed(session?.startedAt ?? null);
  const [showOutcomeModal, setShowOutcomeModal] = useState(false);
  const [showEquipPicker, setShowEquipPicker] = useState(false);
  const [, navigate] = useLocation();

  useCprCycleBeep(elapsed, !!session);

  // isManager: compare session.managerUserId against current logged-in user
  const isManager = session?.managerUserId === userId;
  const cprCycle = Math.floor(elapsed / 120000) + 1;
  const msInCycle = elapsed % 120000;
  const msToNext = 120000 - msInCycle;

  // 15-minute gate: lock Stop CPR button for first 15 * 60 * 1000 ms
  const gateMs = 15 * 60 * 1000;
  const gateOpen = elapsed >= gateMs;
  const gateCountdown = gateOpen ? "" : formatElapsed(gateMs - elapsed);

  const handleEndSession = async (outcome: string) => {
    if (!outcome || !session) return;
    setShowOutcomeModal(false);
    try {
      await api.codeBlue.sessions.end(session.id, { outcome });
      clearCodeBlueSessionCache();
      navigate("/home");
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message || t.codeBlue.endSessionFailed, { id: "cb-end-failed" });
      } else {
        toast.error(t.api.networkUnavailable, { id: "cb-end-failed" });
      }
    }
  };

  // Each quick-log action uses crypto.randomUUID() as idempotencyKey (via logEntry in the hook)
  // The hook internally calls: idempotencyKey: crypto.randomUUID()

  if (!session) return null;

  return (
    <div className="min-h-screen bg-zinc-950 text-white" dir="rtl" style={{ borderTop: "3px solid #dc2626" }}>
      {/* Header */}
      <div className="bg-zinc-900 border-b border-zinc-800 px-4 py-3 flex items-center justify-between">
        <span className="text-red-400 font-black tracking-widest text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" /> CODE BLUE
        </span>
        <div className="flex gap-2 items-center">
          {presence.slice(0, 3).map((p) => (
            <span key={p.userId} className="bg-blue-900 text-blue-300 text-xs px-2 py-0.5 rounded-full">{p.userName}</span>
          ))}
          {presence.length > 3 && (
            <span className="bg-blue-900 text-blue-300 text-xs px-2 py-0.5 rounded-full">+{presence.length - 3}</span>
          )}
        </div>
      </div>

      {/* Cart status */}
      {cartStatus ? (
        <div className={cn(
          "px-4 py-1.5 text-xs flex gap-2 border-b",
          cartStatus.allPassed
            ? "bg-green-500/10 border-green-500/20 text-green-400"
            : "bg-amber-500/10 border-amber-500/20 text-amber-400",
        )}>
          {cartStatus.allPassed
            ? t.codeBlue.preCheck.cartCheckedBy(cartStatus.performedByName)
            : t.codeBlue.preCheck.cartNotChecked}
        </div>
      ) : (
        <div className="px-4 py-1.5 text-xs bg-amber-500/10 border-b border-amber-500/20 text-amber-400">
          {t.codeBlue.preCheck.cartNotChecked}
        </div>
      )}

      {/* Manager badge */}
      <div className="px-4 py-2 bg-zinc-900/50 border-b border-zinc-800 text-xs text-zinc-400 flex items-center gap-2">
        <Shield className="h-3.5 w-3.5 text-blue-400" />
        {t.codeBlue.managerLabelShort} <span className="text-blue-300 font-semibold">{session.managerUserName}</span>
      </div>

      {/* Patient banner */}
      {session.patientName && (
        <div className="px-4 py-2 bg-zinc-900/30 border-b border-zinc-800 text-xs text-amber-300">
          🐕 {session.patientName}{session.patientWeight ? ` — ${t.codeBlue.patientWeightSuffix(session.patientWeight)}` : ""}
        </div>
      )}

      {/* Timer — elapsed computed from session.startedAt */}
      <div className="px-4 py-5 bg-zinc-900 border-b border-zinc-800">
        <div className="text-5xl font-black tracking-widest text-white font-mono leading-none">
          {formatElapsed(elapsed)}
        </div>
        <div className="text-xs text-zinc-500 mt-2">
          {t.codeBlue.cprCycleLine(cprCycle, formatElapsed(msToNext))}
        </div>
      </div>

      {/* Quick log grid */}
      <div className="p-4 border-b border-zinc-800">
        <div className="text-xs text-zinc-500 tracking-widest uppercase mb-3">{t.codeBlue.quickLog}</div>
        <div className="grid grid-cols-2 gap-2">
          {DRUGS.map((drug) => {
            const dose = session.patientWeight
              ? (drug.dosePerKg * session.patientWeight).toFixed(2)
              : null;
            return (
              <button
                key={drug.key}
                type="button"
                onClick={() => logEntry({ label: `${drug.label}${dose ? ` ${dose} ${drug.unit}` : ""}`, category: drug.category })}
                className="bg-red-900/60 hover:bg-red-800/60 border border-red-800/50 rounded-lg p-3 text-center transition-colors"
              >
                <div className="text-white font-bold text-sm">{drug.label}</div>
                {dose && <div className="text-red-300 text-xs mt-0.5">{dose} {drug.unit}</div>}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => logEntry({ label: t.codeBlue.shock, category: "shock" })}
            className="bg-yellow-900/60 hover:bg-yellow-800/60 border border-yellow-800/50 rounded-lg p-3 text-center"
          >
            <Zap className="h-5 w-5 text-yellow-300 mx-auto mb-1" />
            <div className="text-white font-bold text-sm">{t.codeBlue.shock}</div>
          </button>
          <button
            type="button"
            onClick={() => logEntry({ label: t.codeBlue.compressorSwapAction, category: "cpr" })}
            className="bg-blue-900/60 hover:bg-blue-800/60 border border-blue-800/50 rounded-lg p-3 text-center"
          >
            <div className="text-white font-bold text-sm">{t.codeBlue.compressorSwap}</div>
          </button>
          <button
            type="button"
            onClick={() => setShowEquipPicker(true)}
            className="col-span-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg p-3 text-center"
          >
            <div className="text-zinc-200 font-bold text-sm">{t.codeBlue.linkedEquipment}</div>
            <div className="text-zinc-500 text-xs mt-0.5">{t.codeBlue.linkedEquipmentHint}</div>
          </button>
        </div>
      </div>

      {showEquipPicker && (
        <EquipmentPicker
          onSelect={(item) => logEntry({ label: item.name, category: "equipment", equipmentId: item.id })}
          onClose={() => setShowEquipPicker(false)}
        />
      )}

      {/* Timeline */}
      <div className="p-4 border-b border-zinc-800">
        <div className="text-xs text-zinc-500 tracking-widest uppercase mb-3">{t.codeBlue.timeline}</div>
        <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
          {[...logEntries].reverse().map((entry) => (
            <div key={entry.id} className="flex gap-3 text-xs items-baseline">
              <span className="text-zinc-600 font-mono shrink-0">{formatElapsed(entry.elapsedMs)}</span>
              <span className="text-zinc-200">{entry.label}</span>
              <span className="text-green-400 mr-auto shrink-0">{entry.loggedByName}</span>
            </div>
          ))}
          {logEntries.length === 0 && (
            <p className="text-xs text-zinc-600">{t.codeBlue.noEventsYet}</p>
          )}
        </div>
      </div>

      {/* Stop CPR button — isManager gate + 15-min time gate */}
      <div className="p-4">
        {isManager ? (
          gateOpen ? (
            <Button
              className="w-full bg-zinc-700 hover:bg-zinc-600 text-white font-bold py-4"
              onClick={() => setShowOutcomeModal(true)}
            >
              {t.codeBlue.stopCprChooseOutcome}
            </Button>
          ) : (
            <div className="rounded-lg bg-zinc-900 border border-zinc-700 p-4 text-center text-zinc-500 text-sm">
              {t.codeBlue.stopCprLocked(gateCountdown)}
            </div>
          )
        ) : (
          <div className="rounded-lg bg-zinc-900 border border-zinc-700 p-4 text-center text-zinc-600 text-xs">
            {t.codeBlue.managerOnlyHint}
          </div>
        )}
      </div>

      {showOutcomeModal && <OutcomeModal onClose={handleEndSession} />}
    </div>
  );
}

// ─── Page root ────────────────────────────────────────────────────────────────

export default function CodeBluePage() {
  const { userId } = useAuth();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const initHospId = params.get("hospitalizationId") ?? undefined;
  const initPatientId = params.get("patientId") ?? undefined;

  const { session } = useCodeBlueSession();
  const [starting, setStarting] = useState(false);

  // Log entries use crypto.randomUUID() as idempotencyKey for deduplication
  const handleStart = async (preCheckPassed: boolean, manager: { id: string; name: string }) => {
    setStarting(true);
    try {
      await api.codeBlue.sessions.start({
        idempotencyKey: crypto.randomUUID(),
        managerUserId: manager.id,
        managerUserName: manager.name,
        preCheckPassed,
        hospitalizationId: initHospId,
        patientId: initPatientId,
      });
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(
          err.status === 409 ? t.codeBlue.activeSessionExists : err.message || t.codeBlue.startSessionFailed,
        );
      } else {
        toast.error(t.api.networkUnavailable);
      }
    } finally {
      setStarting(false);
    }
  };

  if (session?.status === "active") {
    return <ActiveSession />;
  }

  return <PreCheckGate onStart={handleStart} />;
}
