// src/pages/code-blue.tsx
import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { AlertTriangle, ArrowRight, Package, Shield, StickyNote } from "lucide-react";
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
      {managersQ.isPending && <p className="text-xs text-emergency-text2/60">{t.codeBlue.loadingManagers}</p>}
      {managersQ.data?.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => onSelect(m.id, m.name)}
          className="min-h-[44px] p-2 rounded border border-emergency-border bg-emergency-border text-sm text-emergency-text text-end hover:bg-emergency-border"
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

function PreCheckGate({
  onStart,
  initialEquipmentName,
}: {
  onStart: (passed: boolean, manager: { id: string; name: string }) => void;
  initialEquipmentName?: string;
}) {
  const { userId, role, name } = useAuth();
  const [, navigate] = useLocation();
  const isEligibleManager = role === "vet" || role === "admin";
  const QUICK_CHECK_ITEMS = [
    { key: "unitReady", label: t.codeBlue.preCheck.unitReady },
    { key: "cartReady", label: t.codeBlue.preCheck.cartReady },
    { key: "monitorOnScene", label: t.codeBlue.preCheck.monitorOnScene },
    { key: "transportReady", label: t.codeBlue.preCheck.transportReady },
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
    <div className="flex flex-col h-screen-safe bg-emergency-bg max-w-md mx-auto overflow-hidden" dir="rtl">
      <div className="flex-shrink-0 px-4 pt-4 pb-3">
      {/* Leave before starting — accidental entry must never trap the user. */}
      <button
        type="button"
        onClick={() => navigate("/home")}
        data-testid="code-blue-leave-setup"
        aria-label={t.common.back}
        className="mb-4 flex h-11 items-center gap-1.5 rounded-full border border-emergency-border bg-emergency-border/80 px-3 text-xs font-medium text-emergency-text transition-colors hover:bg-emergency-border motion-safe:active:scale-95"
      >
        <ArrowRight className="h-4 w-4" aria-hidden />
        {t.common.back}
      </button>
      <div className="flex items-center gap-2 text-red-400">
        <AlertTriangle className="h-6 w-6" />
        <h1 className="text-xl font-bold">{t.codeBlue.openTitle}</h1>
      </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-4">

      {initialEquipmentName && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 mb-4 text-sm text-amber-200">
          {t.codeBlue.startingForEquipment(initialEquipmentName)}
        </div>
      )}

      <div className="rounded-lg border border-emergency-border bg-emergency-surface p-4 mb-4">
        <h2 className="text-sm font-semibold text-emergency-text2 mb-3 flex items-center gap-2">
          <Shield className="h-4 w-4" /> {t.codeBlue.managerLabel}
        </h2>
        <p className="text-xs text-emergency-text2/60 mb-3">{t.codeBlue.managerInstruction}</p>
        {isEligibleManager ? (
          <div className="rounded border border-emergency-borderMd bg-emergency-border px-3 py-2 text-sm text-emergency-text">
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

      <div className="rounded-lg border border-emergency-border bg-emergency-surface p-4 mb-4">
        <h2 className="text-sm font-semibold text-emergency-text2 mb-3">{t.codeBlue.preCheck.title}</h2>
        <div className="flex flex-col gap-2">
          {QUICK_CHECK_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => toggle(item.key)}
              className={cn(
                "flex items-center gap-3 p-2 min-h-[44px] rounded border text-sm text-end transition-colors",
                checked[item.key]
                  ? "border-green-500/40 bg-green-500/10 text-green-300"
                  : "border-emergency-border bg-emergency-border text-emergency-text",
              )}
            >
              <span className={cn("h-4 w-4 rounded-full border-2 shrink-0", checked[item.key] ? "border-green-500 bg-green-500" : "border-emergency-text2/60")} />
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
          className="w-full mt-2 min-h-[44px] text-xs text-emergency-text2/60 hover:text-emergency-text2"
          onClick={() => handleStart(false)}
        >
          {t.codeBlue.proceedWithoutFullCheck}
        </button>
      )}
      </div>
    </div>
  );
}

// ─── Outcome modal ───────────────────────────────────────────────────────────

function OutcomeModal({ onClose }: { onClose: (outcome: string) => void }) {
  const OUTCOMES = [
    { value: "rosc", label: t.codeBlue.outcome.rosc },
    { value: "transferred", label: t.codeBlue.outcome.transferred },
    { value: "ongoing", label: t.codeBlue.outcome.ongoing },
    { value: "died", label: t.codeBlue.outcome.died },
  ];
  return (
    <div className="fixed inset-0 bg-black/70 flex items-end justify-center z-50 p-4" dir="rtl">
      <div className="w-full max-w-md bg-emergency-surface rounded-t-2xl border border-emergency-border p-4">
        <h2 className="text-base font-bold text-white mb-4 text-center">{t.codeBlue.selectOutcome}</h2>
        <div className="flex flex-col gap-2">
          {OUTCOMES.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => onClose(o.value)}
              className={cn(
                "p-3 min-h-[44px] rounded-lg border text-sm font-semibold transition-colors text-end",
                o.value === "died"
                  ? "border-red-800 bg-red-950/50 text-red-300 hover:bg-red-900/50"
                  : "border-emergency-border bg-emergency-border text-emergency-text hover:bg-emergency-border",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
        <button type="button" className="w-full mt-3 min-h-[44px] text-xs text-emergency-text2/60" onClick={() => onClose("")}>{t.common.cancel}</button>
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
      <div className="w-full max-w-md bg-emergency-surface rounded-t-2xl border border-emergency-border p-4">
        <h2 className="text-base font-bold text-white mb-4">{t.codeBlue.selectEquipment}</h2>
        <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
          {equipQ.data?.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => { onSelect(item); onClose(); }}
              className="p-3 min-h-[44px] rounded-lg border border-emergency-border bg-emergency-border text-sm text-emergency-text text-end hover:bg-emergency-border"
            >
              {item.name}
            </button>
          ))}
          {equipQ.data?.length === 0 && <p className="text-emergency-text2/60 text-sm">{t.codeBlue.noEquipmentAvailable}</p>}
        </div>
        <button type="button" className="w-full mt-3 min-h-[44px] text-xs text-emergency-text2/60" onClick={onClose}>{t.common.cancel}</button>
      </div>
    </div>
  );
}

// ─── Active session view ──────────────────────────────────────────────────────

function ActiveSession() {
  const { userId } = useAuth();
  const { session, logEntries, presence, cartStatus, linkedEquipment, logEntry } = useCodeBlueSession();
  const elapsed = useElapsed(session?.startedAt ?? null);
  const [showOutcomeModal, setShowOutcomeModal] = useState(false);
  const [showEquipPicker, setShowEquipPicker] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [, navigate] = useLocation();

  const isManager = session?.managerUserId === userId;
  const equipmentLogCount = logEntries.filter((e) => e.category === "equipment").length;

  const handleEndSession = async (outcome: string) => {
    if (!outcome || !session) return;
    setShowOutcomeModal(false);
    try {
      await api.codeBlue.sessions.end(session.id, { outcome });
      clearCodeBlueSessionCache();
      navigate("/home");
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message || t.codeBlue.endSessionFailed, {
          id: "cb-end-failed",
          duration: Infinity,
          action: { label: t.common.tryAgain, onClick: () => setShowOutcomeModal(true) },
        });
      } else {
        toast.error(t.api.networkUnavailable, {
          id: "cb-end-failed",
          duration: Infinity,
          action: { label: t.common.tryAgain, onClick: () => setShowOutcomeModal(true) },
        });
      }
    }
  };

  const submitNote = () => {
    const label = noteDraft.trim();
    if (!label) return;
    logEntry({ label, category: "note" });
    setNoteDraft("");
  };

  if (!session) return null;

  return (
    <div className="flex flex-col h-screen-safe bg-emergency-bg text-white overflow-hidden" dir="rtl" style={{ borderTop: "3px solid var(--destructive)" }}>
      <div className="flex-shrink-0 bg-emergency-surface border-b border-emergency-surface px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Leave the live view without ending the session (it persists for the
              rest of the team). Ending is a separate manager-only action below. */}
          <button
            type="button"
            onClick={() => navigate("/home")}
            data-testid="code-blue-leave"
            aria-label={t.common.back}
            className="flex h-11 items-center gap-1.5 rounded-full border border-emergency-border bg-emergency-border/80 px-3 text-xs font-medium text-emergency-text transition-colors hover:bg-emergency-border motion-safe:active:scale-95"
          >
            <ArrowRight className="h-4 w-4" aria-hidden />
            {t.common.back}
          </button>
          <span className="text-red-400 font-black tracking-widest text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> CODE BLUE
          </span>
        </div>
        <div className="flex gap-2 items-center">
          {presence.slice(0, 3).map((p) => (
            <span key={p.userId} className="bg-blue-900 text-blue-300 text-xs px-2 py-0.5 rounded-full">{p.userName}</span>
          ))}
          {presence.length > 3 && (
            <span className="bg-blue-900 text-blue-300 text-xs px-2 py-0.5 rounded-full">+{presence.length - 3}</span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
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

      <div className="px-4 py-2 bg-emergency-surface/50 border-b border-emergency-surface text-xs text-emergency-text2 flex items-center gap-2">
        <Shield className="h-3.5 w-3.5 text-blue-400" />
        {t.codeBlue.managerLabelShort} <span className="text-blue-300 font-semibold">{session.managerUserName}</span>
      </div>

      <div className="px-4 py-3 bg-emergency-surface/50 border-b border-emergency-surface">
        <div className="text-[10px] font-bold tracking-widest uppercase text-emergency-text2/60 mb-2">
          {t.codeBlue.equipmentInEvent}
        </div>
        {linkedEquipment.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {linkedEquipment.map((eq) => (
              <span
                key={eq.id}
                className="text-xs font-semibold text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-full px-3 py-1"
              >
                {eq.name}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-emergency-text2/60">{t.codeBlue.noEquipmentInEvent}</p>
        )}
      </div>

      <div className="px-4 py-5 bg-emergency-surface border-b border-emergency-surface">
        <div className="text-5xl font-black tracking-widest text-white font-mono leading-none">
          {formatElapsed(elapsed)}
        </div>
        <div className="text-xs text-emergency-text2/60 mt-2">
          {t.codeBlue.elapsedSinceStart}
          {equipmentLogCount > 0 && (
            <span className="text-amber-400/90 me-2"> · {t.codeBlue.equipmentLogCount(equipmentLogCount)}</span>
          )}
        </div>
      </div>

      <div className="p-4 border-b border-emergency-surface">
        <div className="text-xs text-emergency-text2/60 tracking-widest uppercase mb-3">{t.codeBlue.quickLog}</div>
        <button
          type="button"
          onClick={() => setShowEquipPicker(true)}
          className="w-full mb-2 bg-amber-900/50 hover:bg-amber-800/50 border border-amber-700/50 rounded-lg p-4 text-center"
        >
          <Package className="h-6 w-6 text-amber-300 mx-auto mb-1" />
          <div className="text-amber-100 font-bold text-sm">{t.codeBlue.linkedEquipment}</div>
          <div className="text-amber-200/70 text-xs mt-0.5">{t.codeBlue.linkedEquipmentHint}</div>
        </button>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <button
            type="button"
            onClick={() => logEntry({ label: t.codeBlue.presetUnitDeployed, category: "equipment" })}
            className="bg-emergency-border hover:bg-emergency-border border border-emergency-borderMd rounded-lg p-3 min-h-[44px] text-center text-xs font-semibold text-emergency-text"
          >
            {t.codeBlue.presetUnitDeployed}
          </button>
          <button
            type="button"
            onClick={() => logEntry({ label: t.codeBlue.presetUnitReturned, category: "equipment" })}
            className="bg-emergency-border hover:bg-emergency-border border border-emergency-borderMd rounded-lg p-3 min-h-[44px] text-center text-xs font-semibold text-emergency-text"
          >
            {t.codeBlue.presetUnitReturned}
          </button>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder={t.codeBlue.notePlaceholder}
            className="flex-1 rounded-lg border border-emergency-border bg-emergency-surface px-3 py-2 text-sm text-emergency-text placeholder:text-emergency-text2/40"
            maxLength={200}
            onKeyDown={(e) => { if (e.key === "Enter") submitNote(); }}
          />
          <Button
            type="button"
            variant="secondary"
            className="shrink-0 gap-1"
            disabled={!noteDraft.trim()}
            onClick={submitNote}
          >
            <StickyNote className="h-4 w-4" />
            {t.codeBlue.addNote}
          </Button>
        </div>
      </div>

      {showEquipPicker && (
        <EquipmentPicker
          onSelect={(item) => logEntry({ label: item.name, category: "equipment", equipmentId: item.id })}
          onClose={() => setShowEquipPicker(false)}
        />
      )}

      <div className="p-4 border-b border-emergency-surface">
        <div className="text-xs text-emergency-text2/60 tracking-widest uppercase mb-3">{t.codeBlue.timeline}</div>
        <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
          {[...logEntries].reverse().map((entry) => (
            <div key={entry.id} className="flex gap-3 text-xs items-baseline">
              <span className="text-emergency-text2/40 font-mono shrink-0">{formatElapsed(entry.elapsedMs)}</span>
              <span className={cn(
                "shrink-0 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded",
                entry.category === "equipment" ? "bg-amber-500/20 text-amber-300" : "bg-emergency-border text-emergency-text2",
              )}>
                {entry.category === "equipment" ? t.codeBlue.categoryEquipment : t.codeBlue.categoryNote}
              </span>
              <span className="text-emergency-text min-w-0 truncate">{entry.label}</span>
              <span className="text-green-400 mr-auto shrink-0">{entry.loggedByName}</span>
            </div>
          ))}
          {logEntries.length === 0 && (
            <p className="text-xs text-emergency-text2/40">{t.codeBlue.noEventsYet}</p>
          )}
        </div>
      </div>

      <div className="p-4">
        {isManager ? (
          <Button
            className="w-full bg-emergency-border hover:bg-emergency-borderMd text-white font-bold py-4"
            onClick={() => setShowOutcomeModal(true)}
          >
            {t.codeBlue.endEventChooseOutcome}
          </Button>
        ) : (
          <div className="rounded-lg bg-emergency-surface border border-emergency-border p-4 text-center text-emergency-text2/40 text-xs">
            {t.codeBlue.managerOnlyHint}
          </div>
        )}
      </div>

      {showOutcomeModal && <OutcomeModal onClose={handleEndSession} />}
      </div>
    </div>
  );
}

// ─── Page root ────────────────────────────────────────────────────────────────

export default function CodeBluePage() {
  const { userId } = useAuth();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const initEquipmentId = params.get("equipmentId") ?? undefined;

  const { session } = useCodeBlueSession();
  const [starting, setStarting] = useState(false);

  const primaryEquipQ = useQuery<{ name: string } | null>({
    queryKey: ["/api/equipment", initEquipmentId],
    queryFn: async () => {
      const res = await authFetch(`/api/equipment/${initEquipmentId}`);
      if (!res.ok) return null;
      const data = (await res.json()) as { name?: string };
      return data.name ? { name: data.name } : null;
    },
    enabled: !!userId && !!initEquipmentId,
  });

  const handleStart = async (preCheckPassed: boolean, manager: { id: string; name: string }) => {
    setStarting(true);
    try {
      await api.codeBlue.sessions.start({
        idempotencyKey: crypto.randomUUID(),
        managerUserId: manager.id,
        managerUserName: manager.name,
        preCheckPassed,
        ...(initEquipmentId ? { equipmentId: initEquipmentId } : {}),
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

  return (
    <PreCheckGate
      onStart={handleStart}
      initialEquipmentName={primaryEquipQ.data?.name}
    />
  );
}
