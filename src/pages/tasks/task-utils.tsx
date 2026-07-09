// Extracted from Tasks.tsx (Phase 7R R6 — behaviour-preserving move, byte-identical).
// Pure helpers, module constants, and the two standalone presentational
// components used by AppointmentsPage. No logic change — moved for file-size only.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { t, formatDateTimeByLocale } from "@/lib/i18n";
import { Input } from "@/components/ui/input";
import { isCapacitorNative } from "@/lib/capacitor-runtime";
import type { Appointment, AppointmentStatus, TaskPriority } from "@/types";

export const DEFAULT_DAY_START_HOUR = 8;
export const DEFAULT_DAY_END_HOUR = 20;
export const DEFAULT_SLOT_MINUTES = 15;
export const MIN_SLOT_HEIGHT_PX = 44;
export const HOUR_ROW_HEIGHT = 60;
/** Adjustable slot granularities offered in the Interval control (minutes). */
export const SLOT_MINUTE_OPTIONS = [10, 15, 20, 30, 60] as const;
/** Compositor-safe px/minute for a given slot size (keeps a slot ≥ MIN_SLOT_HEIGHT_PX). */
export function pixelsPerMinuteFor(slotMinutes: number): number {
  return Math.max(1.2, MIN_SLOT_HEIGHT_PX / slotMinutes);
}
export const DASHBOARD_REFETCH_MS = 45_000;

export const DURATION_PRESETS = () => [
  { key: "quick-inspection", label: t.appointmentsPage.durationQuickInspection, minutes: 10 },
  { key: "urgent-response", label: t.appointmentsPage.durationUrgentResponse, minutes: 20 },
  { key: "preventive-maintenance", label: t.appointmentsPage.durationPreventive, minutes: 30 },
  { key: "repair-visit", label: t.appointmentsPage.durationRepairVisit, minutes: 45 },
  { key: "calibration", label: t.appointmentsPage.durationCalibration, minutes: 60 },
] as const;

export const ALLOWED_BOOKING_TASK_TYPES = () => [
  { value: "maintenance", label: t.appointmentsPage.typeMaintenanceLabel },
  { value: "repair", label: t.appointmentsPage.typeRepairLabel },
  { value: "inspection", label: t.appointmentsPage.typeInspectionLabel },
] as const;

export const STATUS_COLORS: Record<AppointmentStatus, string> = {
  pending: "bg-muted border-border text-foreground",
  assigned: "bg-primary/5 border-primary/25 text-foreground",
  scheduled: "bg-primary/10 border-primary/35 text-primary",
  arrived: "bg-primary/5 border-primary/30 border-dashed text-foreground",
  in_progress: "bg-muted/80 border-amber-500/30 text-foreground",
  completed: "bg-status-ok/10 border-status-ok/30 text-status-ok",
  cancelled: "bg-destructive/10 border-destructive/30 text-destructive",
  no_show: "bg-muted border-dashed border-border text-muted-foreground",
};

export const PRIORITY_BADGE: Record<string, string> = {
  critical: "bg-destructive text-destructive-foreground border-transparent",
  high: "bg-accent text-accent-foreground border-transparent",
  normal: "bg-muted text-foreground border-border",
};

export function priorityLabel(priority: string | null | undefined): string {
  if (priority === "critical") return t.appointmentsPage.priorityCritical;
  if (priority === "high") return t.appointmentsPage.priorityHigh;
  return t.appointmentsPage.priorityNormal;
}

export const SUGGESTION_SEVERITY_STYLES: Record<"high" | "medium" | "low", string> = {
  high: "border-red-300 bg-red-50 text-red-900",
  medium: "border-amber-300 bg-amber-50 text-amber-900",
  low: "border-border bg-muted/90 text-foreground",
};

export const PRIORITY_COLORS: Record<TaskPriority, string> = {
  critical: "bg-destructive/10 text-destructive border-destructive/30",
  high: "bg-accent text-accent-foreground border-border",
  normal: "bg-muted text-foreground border-border",
};

export const URGENT_BADGE_STYLES = {
  overdue: "text-[10px] bg-red-100 text-red-900 border-red-300",
  critical: "text-[10px] bg-orange-100 text-orange-900 border-orange-300",
} as const;

export const TASK_CARD_STYLES = {
  overdue: "border-red-300 bg-red-50/70",
  critical: "border-orange-300 bg-orange-50/70",
  soon: "border-yellow-300 bg-yellow-50/70",
  normal: "border-border/70 bg-background/80",
};

export const ACTION_BUTTON_BASE = "h-9 px-3 text-sm";

export function ActionTooltip({
  content,
  children,
}: {
  content?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();
  const wrapperRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  if (!content) {
    return <>{children}</>;
  }

  return (
    <span
      ref={wrapperRef}
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onClick={() => setOpen((v) => !v)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setOpen((v) => !v);
        }
      }}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      aria-describedby={open ? tooltipId : undefined}
    >
      {children}
      {open ? (
        <span
          id={tooltipId}
          role="tooltip"
          className="absolute bottom-full left-1/2 z-50 mb-2 w-72 -translate-x-1/2 rounded-lg border border-border bg-popover px-3 py-2 text-xs leading-relaxed text-popover-foreground shadow-xl"
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}

export function todayIsoDate(): string {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

export function toLocalDateTimeInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

export function dateAtLocalDay(dayIso: string, hour: number, minute: number): Date {
  return new Date(`${dayIso}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`);
}

export function minutesSinceDayStart(dayIso: string, date: Date, dayStartHour: number): number {
  const dayStart = dateAtLocalDay(dayIso, dayStartHour, 0).getTime();
  return Math.max(0, Math.floor((date.getTime() - dayStart) / 60000));
}

export function formatTimeHHMM(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * datetime-local field with a readable overlay. iOS renders a native
 * `datetime-local` value in the OS locale (jumbled day/time/year/month order under
 * Hebrew) and that text can't be styled. So we show our own `formatDateTimeByLocale`
 * string in a look-alike box and lay the real (invisible) native input on top purely
 * as the tap target / picker — the user sees a correct string, tapping opens the wheel.
 */
export function LocalDateTimeField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  // Desktop/pointer browsers render datetime-local correctly and need the visible
  // native picker affordance (calendar/spinner). Only iOS jumbles the value under
  // Hebrew — so the readable overlay is scoped to the native shell.
  if (!isCapacitorNative()) {
    return (
      <Input
        id={id}
        type="datetime-local"
        dir="ltr"
        className="text-left"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
      />
    );
  }

  const valid = Boolean(value) && !Number.isNaN(new Date(value).getTime());
  return (
    <div className="relative">
      <div
        aria-hidden
        dir="auto"
        className="flex h-10 w-full items-center rounded-md border border-input bg-background px-3 text-sm"
      >
        {valid ? (
          formatDateTimeByLocale(new Date(value), {
            day: "numeric",
            month: "long",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        ) : (
          <span className="text-muted-foreground">{label}</span>
        )}
      </div>
      <input
        id={id}
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </div>
  );
}

export function statusActions(status: AppointmentStatus): AppointmentStatus[] {
  if (status === "scheduled") return ["arrived", "in_progress", "completed", "cancelled", "no_show"];
  if (status === "arrived") return ["in_progress", "completed", "cancelled", "no_show"];
  if (status === "in_progress") return ["completed", "cancelled"];
  return [];
}

export function toErrorMessage(err: Error): string {
  if (err.message === "APPOINTMENT_CONFLICT") return t.appointmentsPage.errorConflict;
  if (err.message === "OUTSIDE_SHIFT") return t.appointmentsPage.errorOutsideShift;
  if (err.message === "OVERRIDE_REASON_REQUIRED") return t.appointmentsPage.errorOverrideReason;
  if (err.message === "TIMEZONE_REQUIRED") return t.appointmentsPage.errorTimezone;
  if (err.message === "UNAUTHORIZED" || err.message === "Session expired") return t.appointmentsPage.errorSessionExpired;
  if (err.message === "INSUFFICIENT_ROLE") return t.appointmentsPage.errorInsufficientRole;
  if (err.message === "VALIDATION_FAILED") return t.appointmentsPage.errorValidationFailed;
  if (err.message === "TASK_NOT_OWNED_BY_TECH") return t.appointmentsPage.errorTaskNotOwned;
  if (err.message === "TASK_NOT_ASSIGNED") return t.appointmentsPage.errorTaskNotAssigned;
  return err.message;
}

export function canStartTask(a: Appointment, meId: string | undefined, role?: string | null, effectiveRole?: string | null): boolean {
  const resolvedRole = String(effectiveRole ?? role ?? "").trim().toLowerCase();
  if (resolvedRole === "admin") {
    return ["scheduled", "assigned", "arrived"].includes(a.status);
  }
  if (!meId || !a.vetId || a.vetId !== meId) return false;
  return ["scheduled", "assigned", "arrived"].includes(a.status);
}

export function getScheduledIso(appointment: Appointment): string | null {
  if (appointment.scheduledAt) return appointment.scheduledAt;
  return appointment.startTime ?? null;
}

export function formatScheduledLabel(appointment: Appointment): string | null {
  const scheduledIso = getScheduledIso(appointment);
  if (!scheduledIso) return null;
  return t.appointmentsPage.scheduledAt(formatTimeHHMM(new Date(scheduledIso)));
}

export function completeButtonState(args: {
  appointment: Appointment;
  meId?: string;
  effectiveRole?: string;
  role?: string;
}) {
  const { appointment, meId, effectiveRole, role } = args;
  if (appointment.status !== "in_progress") {
    return { visible: false, disabled: true, tooltip: "" };
  }

  const resolvedRole = (effectiveRole || role || "").toLowerCase();
  const isVetOrAdmin = resolvedRole === "vet" || resolvedRole === "admin";
  if (isVetOrAdmin) {
    return { visible: true, disabled: false, tooltip: "" };
  }

  if (!meId || !appointment.vetId || appointment.vetId !== meId) {
    return { visible: false, disabled: true, tooltip: "" };
  }

  return { visible: true, disabled: false, tooltip: "" };
}

export const statusLabel = (): Record<AppointmentStatus, string> => ({
  pending: t.appointmentsPage.statusPending,
  assigned: t.appointmentsPage.statusAssigned,
  scheduled: t.appointmentsPage.statusScheduled,
  arrived: t.appointmentsPage.statusArrived,
  in_progress: t.appointmentsPage.statusInProgress,
  completed: t.appointmentsPage.statusCompleted,
  cancelled: t.appointmentsPage.statusCancelled,
  no_show: t.appointmentsPage.statusNoShow,
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True only for a canonical UUID — a hyphenated free-text name must not match. */
export function looksLikeUuid(s: string): boolean {
  return UUID_RE.test(s);
}

// The `vt_appointments` wire fields are still named animalId/ownerId (frozen
// /api/appointments contract); in the equipment-first product they carry a
// device reference and a location label. These render helpers take the wire
// value under device/location names — client-render clarity only, no wire change.
export function formatDevice(deviceRef: string | null | undefined): string {
  if (!deviceRef) return t.appointmentsPage.unassigned;
  if (looksLikeUuid(deviceRef)) return t.appointmentsPage.linkedDevice;
  return deviceRef;
}

export function formatLocation(location: string | null | undefined): string | null {
  if (!location) return null;
  if (looksLikeUuid(location)) return t.appointmentsPage.linkedOwner;
  return location;
}

export function compactMeta(...parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(" • ");
}

export function getTaskReasonBullets(scoreBreakdown: {
  overdue: number;
  critical: number;
  startsSoon: number;
  assigned: number;
  inProgress: number;
}): string[] {
  const bullets: string[] = [];
  if (scoreBreakdown.overdue > 0) bullets.push(t.appointmentsPage.scoreOverdue);
  if (scoreBreakdown.critical > 0) bullets.push(t.appointmentsPage.scoreCritical);
  if (scoreBreakdown.startsSoon > 0) bullets.push(t.appointmentsPage.scoreStartsSoon);
  if (scoreBreakdown.assigned > 0) bullets.push(t.appointmentsPage.scoreAssigned);
  if (scoreBreakdown.inProgress > 0) bullets.push(t.appointmentsPage.scoreInProgress);
  return bullets;
}

export const USER_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Localized long zone name for the label — never the raw IANA id (M1). */
export function timeZoneDisplayName(tz: string): string {
  try {
    const locale =
      typeof document !== "undefined" ? document.documentElement.lang || undefined : undefined;
    const parts = new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: "long" })
      .formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? tz;
  } catch {
    return tz;
  }
}
export const USER_TIMEZONE_LABEL = timeZoneDisplayName(USER_TIMEZONE);
