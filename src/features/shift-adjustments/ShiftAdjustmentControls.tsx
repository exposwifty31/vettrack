import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarClock, LogOut } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { t } from "@/lib/i18n";
import { useAuth } from "@/hooks/use-auth";
import type { ShiftAdjustmentKind } from "@/types";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

/**
 * On-shift request affordances (Phase 1, increment 3). A rostered person can ask
 * to work past their scheduled end (`extend`) or leave before it (`leave_early`);
 * both go through admin approval. This replaces the old "End Shift" button, which
 * navigated to the handover summary and never actually ended a shift — the
 * roster-derived model has no clock-out.
 *
 * Rendered inside the dark on-shift hero, so the buttons use the hero's on-ink
 * tokens. The request sheet is a separate light surface using standard tokens.
 */

const MIN_REASON_LENGTH = 3;

function localClock(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Map the server's stable reason code to localized copy (route messages are English). */
function createErrorMessage(err: unknown): string {
  const reason = err instanceof ApiError ? err.payload?.reason : undefined;
  switch (reason) {
    case "NOT_ON_SHIFT":
      return t.shiftAdjustments.errNotOnShift;
    case "INVALID_REASON":
      return t.shiftAdjustments.errInvalidReason;
    case "INVALID_TIME":
      return t.shiftAdjustments.errInvalidTime;
    case "NOT_AN_EXTENSION":
      return t.shiftAdjustments.errNotAnExtension;
    case "NOT_EARLIER":
      return t.shiftAdjustments.errNotEarlier;
    case "DUPLICATE_PENDING":
      return t.shiftAdjustments.errDuplicatePending;
    default:
      return t.shiftAdjustments.errGeneric;
  }
}

interface Props {
  /** Scheduled end of the active roster shift (ISO), from `pulse.shift.endsAt`. */
  endsAt: string;
}

export function ShiftAdjustmentControls({ endsAt }: Props) {
  const queryClient = useQueryClient();
  const { userId } = useAuth();
  const [sheetKind, setSheetKind] = useState<ShiftAdjustmentKind | null>(null);
  const currentEndClock = useMemo(() => localClock(endsAt), [endsAt]);
  const [newEnd, setNewEnd] = useState(currentEndClock);
  const [reason, setReason] = useState("");

  const { data: mine } = useQuery({
    queryKey: ["/api/shift-adjustments", "mine"],
    queryFn: () => api.shiftAdjustments.list(),
    staleTime: 30_000,
  });

  // Scope to the active shift window — today or yesterday (overnight shift).
  const activeDates = useMemo(() => {
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return new Set([localDate(today), localDate(yesterday)]);
  }, []);
  // The list endpoint returns ALL clinic requests to admins, so scope to self —
  // otherwise an on-shift admin would see another person's request in their hero.
  const relevant = (mine ?? []).filter(
    (r) => r.requesterUserId === userId && activeDates.has(r.baseShiftDate),
  );
  const pending = relevant.find((r) => r.status === "pending") ?? null;
  const approved = pending ? null : relevant.find((r) => r.status === "approved") ?? null;

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/shift-adjustments"] });

  const createMut = useMutation({
    mutationFn: (kind: ShiftAdjustmentKind) =>
      api.shiftAdjustments.create({ kind, requestedEndTime: newEnd, reason: reason.trim() }),
    onSuccess: () => {
      toast.success(t.shiftAdjustments.createdSuccess);
      invalidate();
      setSheetKind(null);
    },
    onError: (err) => toast.error(createErrorMessage(err)),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => api.shiftAdjustments.cancel(id),
    onSuccess: () => {
      toast.success(t.shiftAdjustments.cancelledSuccess);
      invalidate();
    },
    onError: () => toast.error(t.shiftAdjustments.errGeneric),
  });

  function openSheet(kind: ShiftAdjustmentKind) {
    setNewEnd(currentEndClock);
    setReason("");
    setSheetKind(kind);
  }

  const reasonValid = reason.trim().length >= MIN_REASON_LENGTH;

  if (pending) {
    return (
      <div
        className="mt-[18px] flex items-center justify-between gap-3 rounded-[14px] border px-3.5 py-3"
        style={{ borderColor: "var(--on-ink-muted)", background: "var(--ink-sheen)" }}
        data-testid="shift-adjustment-pending"
      >
        <span className="text-sm font-semibold" style={{ color: "var(--on-ink)" }}>
          {pending.kind === "extend"
            ? t.shiftAdjustments.pendingExtend
            : t.shiftAdjustments.pendingLeaveEarly}
        </span>
        <button
          type="button"
          onClick={() => cancelMut.mutate(pending.id)}
          disabled={cancelMut.isPending}
          data-testid="btn-cancel-adjustment"
          className="shrink-0 text-sm font-bold underline underline-offset-2 disabled:opacity-50"
          style={{ color: "var(--on-ink)" }}
        >
          {t.shiftAdjustments.cancelRequest}
        </button>
      </div>
    );
  }

  return (
    <>
      {approved && (
        <p className="mt-[18px] text-sm font-semibold" style={{ color: "var(--on-ink-strong)" }}>
          {approved.kind === "extend"
            ? t.shiftAdjustments.approvedExtend
            : t.shiftAdjustments.approvedLeaveEarly}
        </p>
      )}
      <div className="mt-[18px] grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={() => openSheet("extend")}
          data-testid="btn-request-extension"
          className="flex h-12 items-center justify-center gap-2 rounded-[14px] text-sm font-bold transition-transform motion-safe:active:scale-[0.99]"
          style={{ background: "var(--on-ink)", color: "var(--brand-ink)" }}
        >
          <CalendarClock className="h-[18px] w-[18px]" aria-hidden />
          {t.shiftAdjustments.requestExtension}
        </button>
        <button
          type="button"
          onClick={() => openSheet("leave_early")}
          data-testid="btn-end-shift"
          className="flex h-12 items-center justify-center gap-2 rounded-[14px] border text-sm font-bold transition-transform motion-safe:active:scale-[0.99]"
          style={{
            borderColor: "var(--on-ink-muted)",
            background: "var(--ink-sheen)",
            color: "var(--on-ink)",
          }}
        >
          <LogOut className="h-[18px] w-[18px]" aria-hidden />
          {t.shiftAdjustments.endShiftEarly}
        </button>
      </div>

      <Sheet open={sheetKind !== null} onOpenChange={(open) => !open && setSheetKind(null)}>
        <SheetContent side="bottom" overlayClassName="z-[60]" className="z-[60] mx-auto max-w-[560px]">
          <SheetHeader>
            <SheetTitle>
              {sheetKind === "leave_early"
                ? t.shiftAdjustments.sheetLeaveEarlyTitle
                : t.shiftAdjustments.sheetExtendTitle}
            </SheetTitle>
            <SheetDescription>
              {sheetKind === "leave_early"
                ? t.shiftAdjustments.sheetLeaveEarlyDesc
                : t.shiftAdjustments.sheetExtendDesc}
            </SheetDescription>
          </SheetHeader>

          <form
            className="mt-4 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (sheetKind && reasonValid) createMut.mutate(sheetKind);
            }}
          >
            <div className="flex items-center justify-between rounded-xl bg-muted px-3.5 py-2.5">
              <span className="text-sm text-muted-foreground">
                {t.shiftAdjustments.currentEndLabel}
              </span>
              <span className="font-num text-sm font-semibold tabular-nums" dir="ltr">
                {currentEndClock}
              </span>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sa-new-end">{t.shiftAdjustments.newEndLabel}</Label>
              <Input
                id="sa-new-end"
                type="time"
                value={newEnd}
                onChange={(e) => setNewEnd(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sa-reason">{t.shiftAdjustments.reasonLabel}</Label>
              <Textarea
                id="sa-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t.shiftAdjustments.reasonPlaceholder}
                rows={3}
                maxLength={500}
                required
              />
            </div>
            <div className="flex gap-2.5 pt-1">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => setSheetKind(null)}
              >
                {t.shiftAdjustments.cancel}
              </Button>
              <Button
                type="submit"
                className="flex-1"
                disabled={!reasonValid || createMut.isPending}
                data-testid="btn-submit-adjustment"
              >
                {createMut.isPending ? t.shiftAdjustments.submitting : t.shiftAdjustments.submit}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
