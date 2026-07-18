/**
 * R-SH-F1.5 — Shift-handover artifact surface (rendered on `/handoff`).
 *
 * iPhone = consume + acknowledge (single pane); iPad = two-pane authoring
 * (content pane + acknowledge pane). The acknowledge control is a DELIBERATE
 * two-step confirm (the attestation exception to undo-first) that is reversible
 * within the shift: `aria-pressed` reflects the acknowledged state, focus moves
 * INTO the confirm affordance when it opens and RETURNS to the trigger on
 * unconfirm/close, and both confirm and unconfirm are keyboard-operable (native
 * buttons). LTR staff names are bidi-isolated. Single `<h1>` + logical heading
 * hierarchy. Presentational only — data + mutations are owned by the caller
 * (`src/pages/handoff.tsx`).
 */
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { t } from "@/lib/i18n";
import { useDirection } from "@/hooks/useDirection";
import { Bdi } from "@/components/ui/bdi";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ShiftHandoverArtifact } from "@/types/shift-handover";

export type HandoverArtifactViewModel = ShiftHandoverArtifact;

export type HandoverPanelState = "loading" | "error" | "empty" | "ready";

export interface HandoverArtifactPanelProps {
  state: HandoverPanelState;
  artifact: HandoverArtifactViewModel | null;
  variant: "phone" | "tablet";
  canAcknowledge: boolean;
  onAcknowledge: () => Promise<void>;
  onUnconfirm: () => Promise<void>;
  /** Optional back affordance (deep-link fallback lives in the page). */
  onBack?: () => void;
}

export function HandoverArtifactPanel({
  state,
  artifact,
  variant,
  canAcknowledge,
  onAcknowledge,
  onUnconfirm,
  onBack,
}: HandoverArtifactPanelProps) {
  // Hebrew is default (RTL): the back affordance must be a direction-aware icon,
  // never a hardcoded "←" glyph (which does not flip). Matches the app's other
  // back controls (e.g. code-blue-history).
  const dir = useDirection();
  const BackIcon = dir === "rtl" ? ArrowRight : ArrowLeft;
  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex items-center gap-2">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label={t.handoverPage.back}
            className="rounded-full px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
          >
            <BackIcon className="h-4 w-4" aria-hidden />
          </button>
        )}
        <h1 className="text-lg font-bold leading-tight">{t.handoverPage.title}</h1>
      </header>

      {state === "loading" && (
        <div role="status" aria-live="polite" className="py-8 text-center text-sm text-muted-foreground">
          {t.handoverPage.loading}
        </div>
      )}

      {state === "error" && (
        <div role="alert" className="py-8 text-center text-sm text-destructive">
          {t.handoverPage.loadError}
        </div>
      )}

      {state === "empty" && (
        <div role="status" className="py-8 text-center">
          <h2 className="text-sm font-semibold">{t.handoverPage.emptyTitle}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t.handoverPage.emptyBody}</p>
        </div>
      )}

      {state === "ready" && artifact && (
        <HandoverBody
          artifact={artifact}
          variant={variant}
          canAcknowledge={canAcknowledge}
          onAcknowledge={onAcknowledge}
          onUnconfirm={onUnconfirm}
        />
      )}
    </div>
  );
}

function HandoverBody({
  artifact,
  variant,
  canAcknowledge,
  onAcknowledge,
  onUnconfirm,
}: {
  artifact: HandoverArtifactViewModel;
  variant: "phone" | "tablet";
  canAcknowledge: boolean;
  onAcknowledge: () => Promise<void>;
  onUnconfirm: () => Promise<void>;
}) {
  const content = <HandoverContent artifact={artifact} />;
  const ack = canAcknowledge ? (
    <AcknowledgeControl artifact={artifact} onAcknowledge={onAcknowledge} onUnconfirm={onUnconfirm} />
  ) : null;

  if (variant === "tablet") {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-4">
        <section data-handover-pane="content" className="min-w-0">
          {content}
        </section>
        <aside data-handover-pane="acknowledge" className="min-w-0">
          {ack}
        </aside>
      </div>
    );
  }

  return (
    <div data-handover-pane="stacked" className="flex flex-col gap-4">
      {content}
      {ack}
    </div>
  );
}

function HandoverContent({ artifact }: { artifact: HandoverArtifactViewModel }) {
  const deltaGroups: Array<[string, number]> = [
    [t.handoverPage.deltaCustody, artifact.deltas.custody.length],
    [t.handoverPage.deltaTasks, artifact.deltas.taskState.length],
    [t.handoverPage.deltaAlerts, artifact.deltas.alerts.length],
    [t.handoverPage.deltaDispenses, artifact.deltas.dispenses.length],
  ];

  return (
    <div className="flex flex-col gap-5">
      <section>
        <h2 className="mb-2 text-sm font-semibold">{t.handoverPage.deltasHeading}</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {deltaGroups.map(([label, count]) => (
            <li key={label} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-1.5">
              <span>{label}</span>
              <span className="tabular-nums font-semibold">{count}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">{t.handoverPage.openItemsHeading}</h2>
        {artifact.openItems.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm">
            {artifact.openItems.map((item) => (
              <li key={item.id} className="rounded-lg bg-muted/50 px-3 py-1.5">
                <Bdi>{item.summary}</Bdi>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t.handoverPage.openItemsNone}</p>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">{t.handoverPage.worklistHeading}</h2>
        <PatientWorklistView artifact={artifact} />
      </section>

      {artifact.staff.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">{t.handoverPage.staffHeading}</h2>
          <ul className="flex flex-wrap gap-2 text-sm">
            {artifact.staff.map((s) => (
              <li key={s.userId} className="rounded-full bg-muted/60 px-3 py-1">
                <Bdi dir="ltr">{s.name}</Bdi>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function PatientWorklistView({ artifact }: { artifact: HandoverArtifactViewModel }) {
  const wl = artifact.patientWorklist;
  if (wl.state === "not_configured") {
    return <p className="text-sm text-muted-foreground">{t.handoverPage.worklistNotConfigured}</p>;
  }
  if (wl.state === "error") {
    return (
      <p role="status" className="text-sm text-amber-700">
        {t.handoverPage.worklistError}
      </p>
    );
  }
  if (wl.entries.length === 0) {
    return <p className="text-sm text-muted-foreground">{t.handoverPage.worklistEmpty}</p>;
  }
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {wl.entries.map((entry) => (
        <li key={entry.externalId} className="rounded-lg bg-muted/50 px-3 py-1.5">
          <Bdi>{entry.display}</Bdi>
        </li>
      ))}
    </ul>
  );
}

function AcknowledgeControl({
  artifact,
  onAcknowledge,
  onUnconfirm,
}: {
  artifact: HandoverArtifactViewModel;
  onAcknowledge: () => Promise<void>;
  onUnconfirm: () => Promise<void>;
}) {
  const isAcknowledged = artifact.acknowledgedBy != null;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const triggerRef = useRef<HTMLButtonElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const wasAcknowledged = useRef(isAcknowledged);
  const pendingUnconfirm = useRef(false);
  const pendingAck = useRef(false);

  // Focus INTO the confirm affordance when it discloses.
  useEffect(() => {
    if (confirmOpen) confirmRef.current?.focus();
  }, [confirmOpen]);

  // React to a SERVER-CONFIRMED acknowledged-state transition (the parent
  // re-renders with the flipped artifact): move focus to the stable control and
  // announce the result via the live region — the UI never optimistically flips.
  useEffect(() => {
    const was = wasAcknowledged.current;
    // Guarded on the local-initiation flags so a transition driven by THIS user's
    // ack/unconfirm moves focus + announces — while any future remote or refetch
    // flip of the artifact never steals focus or fires a stray announcement.
    if (!was && isAcknowledged && pendingAck.current) {
      undoRef.current?.focus();
      setAnnouncement(t.handoverPage.acknowledgedLabel);
      pendingAck.current = false;
    } else if (was && !isAcknowledged && pendingUnconfirm.current) {
      triggerRef.current?.focus();
      setAnnouncement(t.handoverPage.unconfirmedAnnounce);
      pendingUnconfirm.current = false;
    }
    wasAcknowledged.current = isAcknowledged;
  }, [isAcknowledged]);

  const handleConfirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    pendingAck.current = true;
    try {
      await onAcknowledge();
      // The parent flips the artifact → acknowledged on server confirmation; the
      // transition effect above then moves focus + announces. Close the disclosure.
      setConfirmOpen(false);
    } catch {
      // Keep the confirm affordance open so the user can retry a failed attempt.
      pendingAck.current = false;
      setError(t.handoverPage.acknowledgeError);
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = () => {
    setConfirmOpen(false);
    triggerRef.current?.focus();
  };

  const handleUnconfirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    pendingUnconfirm.current = true;
    try {
      await onUnconfirm();
      // Stays acknowledged until the parent flips it back (server-confirmed); the
      // transition effect handles focus return + the undo announcement.
    } catch {
      setError(t.handoverPage.unconfirmError);
      pendingUnconfirm.current = false;
    } finally {
      setBusy(false);
    }
  };

  const body = isAcknowledged ? (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
      <p className="mb-2 text-sm font-semibold text-emerald-800">{t.handoverPage.acknowledgedLabel}</p>
      <Button
        ref={undoRef}
        type="button"
        variant="outline"
        size="sm"
        aria-pressed="true"
        onClick={() => void handleUnconfirm()}
        disabled={busy}
      >
        {t.handoverPage.unconfirmCta}
      </Button>
    </div>
  ) : (
    <div className="flex flex-col gap-2">
      <Button
        ref={triggerRef}
        type="button"
        className={cn("w-full")}
        aria-haspopup="dialog"
        aria-expanded={confirmOpen}
        onClick={() => setConfirmOpen(true)}
      >
        {t.handoverPage.acknowledgeCta}
      </Button>
      {confirmOpen && (
        <div
          role="dialog"
          aria-label={t.handoverPage.acknowledgePrompt}
          onKeyDown={(e) => {
            if (e.key === "Escape") handleCancel();
          }}
          className="rounded-xl border border-primary/30 bg-primary/5 p-3"
        >
          <p className="mb-2 text-sm font-medium">{t.handoverPage.acknowledgePrompt}</p>
          <div className="flex gap-2">
            <Button ref={confirmRef} type="button" size="sm" onClick={() => void handleConfirm()} disabled={busy}>
              {t.handoverPage.acknowledgeConfirm}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={handleCancel} disabled={busy}>
              {t.handoverPage.acknowledgeCancel}
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-2">
      {body}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {/* Stable polite live region — survives the confirm→acknowledged unmount so
          the success/undo result is announced, not lost. */}
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}
