// src/pages/code-blue.tsx
import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { AlertTriangle, ArrowRight, CheckCircle2, Circle, Loader2, Package, Shield, StickyNote } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { authFetch } from "@/lib/auth-fetch";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { clearCodeBlueSessionCache, useCodeBlueSession } from "@/hooks/useCodeBlueSession";
import { Bdi } from "@/components/ui/bdi";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";
import { useDirection } from "@/hooks/useDirection";
import { useNativeShellContext } from "@/native/NativeShellContext";
import { toast } from "sonner";
import { haptics } from "@/lib/haptics";
import { playCriticalAlertTone } from "@/lib/sounds";

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
      {managersQ.isPending && <p className="text-xs text-emergency-text2/80">{t.codeBlue.loadingManagers}</p>}
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
        <p className="text-xs text-emergency-accent">{t.codeBlue.noManagersAvailable}</p>
      )}
    </div>
  );
}

// ─── Pre-check gate ──────────────────────────────────────────────────────────

// Exported for tests (C1 regression — armed-but-silent start button).
export function PreCheckGate({
  onStart,
  starting,
  initialEquipmentName,
}: {
  onStart: (passed: boolean, manager: { id: string; name: string }) => void;
  starting: boolean;
  initialEquipmentName?: string;
}) {
  const { userId, role, name } = useAuth();
  const [, navigate] = useLocation();
  const dir = useDirection();
  const inNativeShell = useNativeShellContext();
  // Only a vet is auto-assigned as the "responsible vet" event manager. An admin
  // is NOT auto-filled (an identity-admin is not the clinical event manager) — they
  // pick the responsible clinician via the manager list. The SERVER stays the
  // enforcement boundary (`requireClinicalAuthority`, `allowSystemAdmin: false`),
  // and an admin holding a shift-derived clinical role can still legitimately
  // initiate, so the start is never hard-blocked here (F3).
  const isEligibleManager = role === "vet";
  const QUICK_CHECK_ITEMS = [
    { key: "unitReady", label: t.codeBlue.preCheck.unitReady },
    { key: "cartReady", label: t.codeBlue.preCheck.cartReady },
    { key: "monitorOnScene", label: t.codeBlue.preCheck.monitorOnScene },
    { key: "transportReady", label: t.codeBlue.preCheck.transportReady },
  ];
  const [checked, setChecked] = useState<Record<string, boolean>>(
    Object.fromEntries(QUICK_CHECK_ITEMS.map((i) => [i.key, false])),
  );
  const [pickedManager, setPickedManager] = useState<{ id: string; name: string } | null>(null);

  // Derived (not state-seeded): useAuth().name can arrive after mount, and the
  // display name is cosmetic — identity is the id. A missing name must never
  // block the emergency, so eligible managers fall back to a generic label.
  const manager = isEligibleManager
    ? userId
      ? { id: userId, name: (name ?? "").trim() || t.codeBlue.managerFallbackName }
      : null
    : pickedManager;
  const canStart = manager !== null && !starting;

  const allChecked = QUICK_CHECK_ITEMS.every((i) => checked[i.key]);

  const toggle = (key: string) => setChecked((p) => ({ ...p, [key]: !p[key] }));

  const handleStart = (passed: boolean) => {
    if (!manager || starting) return;
    onStart(passed, manager);
  };

  return (
    <div className="flex flex-col bg-emergency-bg w-full overflow-hidden" dir={dir} style={{ height: "100%", paddingTop: "env(safe-area-inset-top)" }}>
      <div className="flex-shrink-0 px-4 pt-4 pb-3">
      {/* Leave before starting — accidental entry must never trap the user.
          Inside the native shell Emergency is a tab root and the tab bar /
          sidebar is always visible, so a back-to-home affordance is redundant
          there (M6); the web page keeps it. */}
      {!inNativeShell && (
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
      )}
      <div className="flex items-center gap-2 text-emergency-accent">
        <AlertTriangle className="h-6 w-6 shrink-0" aria-hidden />
        <h1 className="text-xl font-bold text-emergency-accent">{t.codeBlue.openTitle}</h1>
      </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-4">

      {initialEquipmentName && (
        <div className="rounded-lg border border-emergency-amber/30 bg-emergency-amber/10 px-4 py-3 mb-4 text-sm text-emergency-amber">
          {t.codeBlue.startingForEquipment(initialEquipmentName)}
        </div>
      )}

      <div className="rounded-lg border border-emergency-border bg-emergency-surface p-4 mb-4">
        <h2 className="text-sm font-semibold text-emergency-text2 mb-3 flex items-center gap-2">
          <Shield className="h-4 w-4 shrink-0" aria-hidden /> {t.codeBlue.managerLabel}
        </h2>
        <p className="text-xs text-emergency-text2/80 mb-3">{t.codeBlue.managerInstruction}</p>
        {isEligibleManager ? (
          <div className="rounded border border-emergency-borderMd bg-emergency-border px-3 py-2 text-sm text-emergency-text">
            {manager?.name ?? t.codeBlue.managerFallbackName} {t.codeBlue.you}
          </div>
        ) : (
          <>
            <ManagerPicker onSelect={(id, n) => setPickedManager({ id, name: n })} />
            {pickedManager && (
              <div className="mt-2 text-xs text-[rgb(var(--sys-green))]">{t.codeBlue.selectedManager(pickedManager.name)}</div>
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
              aria-pressed={checked[item.key]}
              onClick={() => toggle(item.key)}
              className={cn(
                "flex items-center gap-3 p-2 min-h-[44px] rounded border text-sm transition-colors",
                dir === "rtl" ? "text-end" : "text-start",
                checked[item.key]
                  ? "border-[rgb(var(--sys-green)/0.4)] bg-[rgb(var(--sys-green)/0.1)] text-[rgb(var(--sys-green))]"
                  : "border-emergency-border bg-emergency-border text-emergency-text",
              )}
            >
              {checked[item.key]
                ? <CheckCircle2 className="h-5 w-5 text-[rgb(var(--sys-green))] shrink-0" aria-hidden />
                : <Circle className="h-5 w-5 text-emergency-text2/60 shrink-0" aria-hidden />}
              <span className="flex-1 min-w-0 [writing-mode:horizontal-tb]">{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      <Button
        className="w-full bg-emergency-accent hover:bg-emergency-accent/90 text-white font-bold disabled:bg-emergency-accent/35 disabled:text-white/70"
        disabled={!canStart}
        onClick={() => handleStart(allChecked)}
        data-testid="code-blue-start"
      >
        {starting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {starting ? t.codeBlue.startingSession : t.codeBlue.openButton}
      </Button>
      {!manager && !starting && (
        <p className="mt-2 text-xs text-emergency-text2 text-center" role="status">
          {t.codeBlue.startDisabledReason}
        </p>
      )}
      {!allChecked && (
        <button
          type="button"
          disabled={!canStart}
          className="w-full mt-2 min-h-[44px] rounded-lg border border-emergency-border/50 text-xs text-emergency-text2/80 hover:text-emergency-text2 hover:bg-emergency-border/30 transition-colors disabled:opacity-50 disabled:pointer-events-none"
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
  const dir = useDirection();
  const OUTCOMES = [
    { value: "rosc", label: t.codeBlue.outcome.rosc },
    { value: "transferred", label: t.codeBlue.outcome.transferred },
    { value: "ongoing", label: t.codeBlue.outcome.ongoing },
    { value: "died", label: t.codeBlue.outcome.died },
  ];
  return (
    <div className="fixed inset-0 bg-black/70 flex items-end justify-center z-50 p-4" dir={dir}>
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
                  ? "border-emergency-accent/50 bg-emergency-accent/15 text-emergency-accent hover:bg-emergency-accent/25"
                  : "border-emergency-border bg-emergency-border text-emergency-text hover:bg-emergency-border",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
        <button type="button" className="w-full mt-3 min-h-[44px] text-xs text-emergency-text2/80" onClick={() => onClose("")}>{t.common.cancel}</button>
      </div>
    </div>
  );
}

// ─── Equipment picker ─────────────────────────────────────────────────────────

interface EquipmentItem { id: string; name: string; }

function EquipmentPicker({ onSelect, onClose }: { onSelect: (item: EquipmentItem) => void; onClose: () => void }) {
  const { userId } = useAuth();
  const dir = useDirection();
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
    <div className="fixed inset-0 bg-black/70 flex items-end justify-center z-50 p-4" dir={dir}>
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
          {equipQ.data?.length === 0 && <p className="text-emergency-text2 text-sm">{t.codeBlue.noEquipmentAvailable}</p>}
        </div>
        <button type="button" className="w-full mt-3 min-h-[44px] text-xs text-emergency-text2/80" onClick={onClose}>{t.common.cancel}</button>
      </div>
    </div>
  );
}

// ─── Active session view ──────────────────────────────────────────────────────

function ActiveSession() {
  const { userId } = useAuth();
  const dir = useDirection();
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
        toast.error(t.codeBlue.endSessionFailed, {
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
    <div className="flex flex-col bg-emergency-bg text-white overflow-hidden" dir={dir} style={{ height: "100%", paddingTop: "env(safe-area-inset-top)", borderTop: "3px solid var(--destructive)" }}>
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
          <span className="text-emergency-accent font-black tracking-widest text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> CODE BLUE
          </span>
        </div>
        <div className="flex gap-2 items-center">
          {presence.slice(0, 3).map((p) => (
            <span key={p.userId} className="bg-[hsl(var(--status-sterilized))]/20 text-[hsl(var(--status-sterilized))] text-xs px-2 py-0.5 rounded-full">{p.userName}</span>
          ))}
          {presence.length > 3 && (
            <span className="bg-[hsl(var(--status-sterilized))]/20 text-[hsl(var(--status-sterilized))] text-xs px-2 py-0.5 rounded-full">+{presence.length - 3}</span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
      {cartStatus ? (
        <div className={cn(
          "px-4 py-1.5 text-xs flex gap-2 border-b",
          cartStatus.allPassed
            ? "bg-[rgb(var(--sys-green)/0.1)] border-[rgb(var(--sys-green)/0.2)] text-[rgb(var(--sys-green))]"
            : "bg-emergency-amber/10 border-emergency-amber/20 text-emergency-amber",
        )}>
          {cartStatus.allPassed
            ? t.codeBlue.preCheck.cartCheckedBy(cartStatus.performedByName)
            : t.codeBlue.preCheck.cartNotChecked}
        </div>
      ) : (
        <div className="px-4 py-1.5 text-xs bg-emergency-amber/10 border-b border-emergency-amber/20 text-emergency-amber">
          {t.codeBlue.preCheck.cartNotChecked}
        </div>
      )}

      <div className="px-4 py-2 bg-emergency-surface/50 border-b border-emergency-surface text-xs text-emergency-text2 flex items-center gap-2">
        <Shield className="h-3.5 w-3.5 text-[hsl(var(--status-sterilized))]" />
        {t.codeBlue.managerLabelShort} <span className="text-[hsl(var(--status-sterilized))] font-semibold"><Bdi>{session.managerUserName}</Bdi></span>
      </div>

      <div className="px-4 py-3 bg-emergency-surface/50 border-b border-emergency-surface">
        <div className="vt-text-2xs font-bold tracking-widest uppercase text-emergency-text2/80 mb-2">
          {t.codeBlue.equipmentInEvent}
        </div>
        {linkedEquipment.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {linkedEquipment.map((eq) => (
              <span
                key={eq.id}
                className="text-xs font-semibold text-emergency-amber bg-emergency-amber/10 border border-emergency-amber/30 rounded-full px-3 py-1"
              >
                {eq.name}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-emergency-text2/80">{t.codeBlue.noEquipmentInEvent}</p>
        )}
      </div>

      <div className="px-4 py-5 bg-emergency-surface border-b border-emergency-surface">
        <div className="text-5xl font-black tracking-widest text-white font-num leading-none">
          {formatElapsed(elapsed)}
        </div>
        <div className="text-xs text-emergency-text2/80 mt-2">
          {t.codeBlue.elapsedSinceStart}
          {equipmentLogCount > 0 && (
            <span className="text-emergency-amber/90 me-2"> · {t.codeBlue.equipmentLogCount(equipmentLogCount)}</span>
          )}
        </div>
      </div>

      <div className="p-4 border-b border-emergency-surface">
        <div className="text-xs text-emergency-text2/80 tracking-widest uppercase mb-3">{t.codeBlue.quickLog}</div>
        <button
          type="button"
          onClick={() => setShowEquipPicker(true)}
          className="w-full mb-2 bg-emergency-amber/15 hover:bg-emergency-amber/25 border border-emergency-amber/40 rounded-lg p-4 text-center"
        >
          <Package className="h-6 w-6 text-emergency-amber mx-auto mb-1" />
          <div className="text-emergency-amber font-bold text-sm">{t.codeBlue.linkedEquipment}</div>
          <div className="text-emergency-amber/70 text-xs mt-0.5">{t.codeBlue.linkedEquipmentHint}</div>
        </button>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <button
            type="button"
            onClick={() => { haptics.scanSuccess(); logEntry({ label: t.codeBlue.presetUnitDeployed, category: "equipment" }); }}
            className="bg-emergency-border hover:bg-emergency-border border border-emergency-borderMd rounded-lg p-3 min-h-[44px] text-center text-xs font-semibold text-emergency-text"
          >
            {t.codeBlue.presetUnitDeployed}
          </button>
          <button
            type="button"
            onClick={() => { haptics.scanSuccess(); logEntry({ label: t.codeBlue.presetUnitReturned, category: "equipment" }); }}
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
            className="flex-1 rounded-lg border border-emergency-border bg-emergency-surface px-3 py-2 text-sm text-emergency-text placeholder:text-emergency-text2/80"
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
        <div className="text-xs text-emergency-text2 tracking-widest uppercase mb-3">{t.codeBlue.timeline}</div>
        <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
          {[...logEntries].reverse().map((entry) => (
            <div key={entry.id} className="flex gap-3 text-xs items-baseline">
              <span className="text-emergency-text2 font-mono shrink-0">{formatElapsed(entry.elapsedMs)}</span>
              <span className={cn(
                "shrink-0 vt-text-2xs uppercase tracking-wide px-1.5 py-0.5 rounded",
                entry.category === "equipment" ? "bg-emergency-amber/20 text-emergency-amber" : "bg-emergency-border text-emergency-text2",
              )}>
                {entry.category === "equipment" ? t.codeBlue.categoryEquipment : t.codeBlue.categoryNote}
              </span>
              <span className="text-emergency-text min-w-0 truncate">{entry.label}</span>
              <span className="text-[rgb(var(--sys-green))] mr-auto shrink-0">{entry.loggedByName}</span>
            </div>
          ))}
          {logEntries.length === 0 && (
            <p className="text-xs text-emergency-text2">{t.codeBlue.noEventsYet}</p>
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
          <div className="rounded-lg bg-emergency-surface border border-emergency-border p-4 text-center text-emergency-text2 text-xs">
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

  const { session, isLoading: sessionLoading, isError: sessionError, refetch } = useCodeBlueSession();
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
      haptics.error();
      void playCriticalAlertTone();
      // Server-confirmed transition: pull the active session now instead of
      // waiting out the 2 s poll. Never flips local session state.
      await refetch();
    } catch (err) {
      // Localized, non-leaky messages only — never surface the raw server string
      // or the requestId to the user. A failed emergency action stays visible
      // longer than a normal toast (F2). The `code` set here is the server's
      // stable reason, not free-form copy.
      if (err instanceof ApiError) {
        // Map the server's stable `code` first — a 403 can be a clinical-authority
        // denial OR a blocked/pending account, which need different messages.
        // Fall back to status only for the generic cases.
        const message =
          err.code === "ACCOUNT_BLOCKED"
            ? t.auth.guard.blockedTitle
            : err.code === "ACCOUNT_PENDING_APPROVAL"
              ? t.auth.guard.pendingTitle
              : err.code === "INSUFFICIENT_ROLE" || err.code === "MANAGER_NOT_CODE_BLUE_ELIGIBLE"
                ? t.codeBlue.clinicalAuthorityRequired
                : err.status === 409
                  ? t.codeBlue.activeSessionExists
                  : t.codeBlue.startSessionFailed;
        toast.error(message, { duration: 8000 });
      } else {
        toast.error(t.api.networkUnavailable, { duration: 8000 });
      }
    } finally {
      setStarting(false);
    }
  };

  // Re-entering /code-blue while a session is active must land on the live
  // ActiveSession view, never the launch form. `session` is `null` (not yet
  // "unknown") while the active-session query is still pending — without this
  // guard, a re-entry with no cached placeholder (fresh app launch, a device
  // that hasn't polled this session yet, cache cleared) would fall through to
  // the launch form for one query cycle before correcting itself (2026-07-10
  // QA audit caveat E-c).
  if (sessionLoading) {
    return (
      <div
        data-testid="code-blue-loading"
        className="flex flex-col items-center justify-center gap-3 bg-emergency-bg w-full"
        style={{ height: "100%", paddingTop: "env(safe-area-inset-top)" }}
      >
        <Loader2 className="h-6 w-6 animate-spin text-emergency-text2" aria-hidden />
        <p className="text-sm text-emergency-text2">{t.codeBlue.checkingActiveSession}</p>
      </div>
    );
  }

  // A confirmed active session always wins — render it even if a subsequent
  // poll errored. An active Code Blue must stay visible through a transient
  // blip; TanStack keeps status:'success'/isError:false while real data is
  // held, so a genuinely active session is reached before the error guard.
  if (session?.status === "active") {
    return <ActiveSession />;
  }

  // With no active session to show, a FAILED active-session check is still not
  // a confirmed "no active session" — falling through to the launch form here
  // would let staff open a duplicate/erroneous session while an existing one is
  // unreachable, or miss re-entering a genuinely active one. Block on a
  // retryable error state instead of assuming "none" (2026-07-10 QA audit
  // caveat E-c follow-up).
  if (sessionError) {
    return (
      <div
        data-testid="code-blue-session-error"
        className="flex flex-col items-center justify-center gap-3 bg-emergency-bg w-full p-6 text-center"
        style={{ height: "100%", paddingTop: "env(safe-area-inset-top)" }}
      >
        <AlertTriangle className="h-6 w-6 text-emergency-amber" aria-hidden />
        <p className="text-sm text-emergency-text2">{t.codeBlue.sessionCheckFailed}</p>
        <Button variant="secondary" onClick={() => refetch()}>
          {t.errorCard.retry}
        </Button>
      </div>
    );
  }

  return (
    <PreCheckGate
      onStart={handleStart}
      starting={starting}
      initialEquipmentName={primaryEquipQ.data?.name}
    />
  );
}
