import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Redirect } from "wouter";
import { t } from "@/lib/i18n";
import { useDirection } from "@/hooks/useDirection";
import { CalendarDays, CheckCircle2, ChevronRight, Clock3, Plus, User, Zap } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import type { SidebarItem } from "@/components/layout/IconSidebar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingSection } from "@/components/ui/loading-section";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ErrorCard } from "@/components/ui/error-card";
import { EmptyState } from "@/components/ui/empty-state";
import { api } from "@/lib/api";
import { leaderPoll } from "@/lib/leader";
import { useRealtime } from "@/hooks/useRealtime";
import { useRealtimeReconciliation } from "@/hooks/useRealtimeReconciliation";
import { useTaskRecommendations } from "@/hooks/useTaskRecommendations";
import { useAuth } from "@/hooks/use-auth";
import type { Appointment, AppointmentStatus, CreateAppointmentRequest, TaskPriority } from "@/types";
import { toast } from "sonner";
import { toastSuccess } from "@/lib/ui-toast";

const DAY_START_HOUR = 8;
const DAY_END_HOUR = 20;
const SLOT_MINUTES = 15;
const MIN_SLOT_HEIGHT_PX = 44;
const PIXELS_PER_MINUTE = Math.max(1.2, MIN_SLOT_HEIGHT_PX / SLOT_MINUTES);
const HOUR_ROW_HEIGHT = 60;
const DASHBOARD_REFETCH_MS = 45_000;

const DURATION_PRESETS = () => [
  { key: "quick-inspection", label: t.appointmentsPage.durationQuickInspection, minutes: 10 },
  { key: "urgent-response", label: t.appointmentsPage.durationUrgentResponse, minutes: 20 },
  { key: "preventive-maintenance", label: t.appointmentsPage.durationPreventive, minutes: 30 },
  { key: "repair-visit", label: t.appointmentsPage.durationRepairVisit, minutes: 45 },
  { key: "calibration", label: t.appointmentsPage.durationCalibration, minutes: 60 },
] as const;

const ALLOWED_BOOKING_TASK_TYPES = () => [
  { value: "maintenance", label: t.appointmentsPage.typeMaintenanceLabel },
  { value: "repair", label: t.appointmentsPage.typeRepairLabel },
  { value: "inspection", label: t.appointmentsPage.typeInspectionLabel },
] as const;

const STATUS_COLORS: Record<AppointmentStatus, string> = {
  pending: "bg-muted border-border text-foreground",
  assigned: "bg-primary/5 border-primary/25 text-foreground",
  scheduled: "bg-primary/10 border-primary/35 text-primary",
  arrived: "bg-primary/5 border-primary/30 border-dashed text-foreground",
  in_progress: "bg-muted/80 border-amber-500/30 text-foreground",
  completed: "bg-status-ok/10 border-status-ok/30 text-status-ok",
  cancelled: "bg-destructive/10 border-destructive/30 text-destructive",
  no_show: "bg-muted border-dashed border-border text-muted-foreground",
};

const PRIORITY_BADGE: Record<string, string> = {
  critical: "bg-destructive text-destructive-foreground border-transparent",
  high: "bg-accent text-accent-foreground border-transparent",
  normal: "bg-muted text-foreground border-border",
};

function priorityLabel(priority: string | null | undefined): string {
  if (priority === "critical") return t.appointmentsPage.priorityCritical;
  if (priority === "high") return t.appointmentsPage.priorityHigh;
  return t.appointmentsPage.priorityNormal;
}

const SUGGESTION_SEVERITY_STYLES: Record<"high" | "medium" | "low", string> = {
  high: "border-red-300 bg-red-50 text-red-900",
  medium: "border-amber-300 bg-amber-50 text-amber-900",
  low: "border-border bg-muted/90 text-foreground",
};

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  critical: "bg-destructive/10 text-destructive border-destructive/30",
  high: "bg-accent text-accent-foreground border-border",
  normal: "bg-muted text-foreground border-border",
};

const URGENT_BADGE_STYLES = {
  overdue: "text-[10px] bg-red-100 text-red-900 border-red-300",
  critical: "text-[10px] bg-orange-100 text-orange-900 border-orange-300",
} as const;

const TASK_CARD_STYLES = {
  overdue: "border-red-300 bg-red-50/70",
  critical: "border-orange-300 bg-orange-50/70",
  soon: "border-yellow-300 bg-yellow-50/70",
  normal: "border-border/70 bg-background/80",
};

const ACTION_BUTTON_BASE = "h-9 px-3 text-sm";

function ActionTooltip({
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
      tabIndex={0}
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

function todayIsoDate(): string {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

function toLocalDateTimeInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

function dateAtLocalDay(dayIso: string, hour: number, minute: number): Date {
  return new Date(`${dayIso}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`);
}

function minutesSinceDayStart(dayIso: string, date: Date): number {
  const dayStart = dateAtLocalDay(dayIso, DAY_START_HOUR, 0).getTime();
  return Math.max(0, Math.floor((date.getTime() - dayStart) / 60000));
}

function formatTimeHHMM(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function statusActions(status: AppointmentStatus): AppointmentStatus[] {
  if (status === "scheduled") return ["arrived", "in_progress", "completed", "cancelled", "no_show"];
  if (status === "arrived") return ["in_progress", "completed", "cancelled", "no_show"];
  if (status === "in_progress") return ["completed", "cancelled"];
  return [];
}

function toErrorMessage(err: Error): string {
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

function canStartTask(a: Appointment, meId: string | undefined, role?: string | null, effectiveRole?: string | null): boolean {
  const resolvedRole = String(effectiveRole ?? role ?? "").trim().toLowerCase();
  if (resolvedRole === "admin") {
    return ["scheduled", "assigned", "arrived"].includes(a.status);
  }
  if (!meId || !a.vetId || a.vetId !== meId) return false;
  return ["scheduled", "assigned", "arrived"].includes(a.status);
}

function getScheduledIso(appointment: Appointment): string | null {
  if (appointment.scheduledAt) return appointment.scheduledAt;
  return appointment.startTime ?? null;
}

function formatScheduledLabel(appointment: Appointment): string | null {
  const scheduledIso = getScheduledIso(appointment);
  if (!scheduledIso) return null;
  return t.appointmentsPage.scheduledAt(formatTimeHHMM(new Date(scheduledIso)));
}

function completeButtonState(args: {
  appointment: Appointment;
  meId?: string;
  meClerkId?: string | null;
  effectiveRole?: string;
  role?: string;
}) {
  const { appointment, meId, meClerkId, effectiveRole, role } = args;
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

const statusLabel = (): Record<AppointmentStatus, string> => ({
  pending: t.appointmentsPage.statusPending,
  assigned: t.appointmentsPage.statusAssigned,
  scheduled: t.appointmentsPage.statusScheduled,
  arrived: t.appointmentsPage.statusArrived,
  in_progress: t.appointmentsPage.statusInProgress,
  completed: t.appointmentsPage.statusCompleted,
  cancelled: t.appointmentsPage.statusCancelled,
  no_show: t.appointmentsPage.statusNoShow,
});

function looksLikeUuid(s: string): boolean {
  return s.includes("-") && s.length > 20;
}

function formatDevice(animalId: string | null | undefined): string {
  if (!animalId) return t.appointmentsPage.unassigned;
  if (looksLikeUuid(animalId)) return t.appointmentsPage.linkedDevice;
  return animalId;
}

function PatientChartLink({ animalId }: { animalId: string | null | undefined }) {
  if (!animalId || !looksLikeUuid(animalId)) return null;
  return (
    <Link
      href={`/patients/${animalId}`}
      className="inline-flex shrink-0 items-center rounded-md border border-primary/25 bg-primary/5 px-2 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/10"
    >
      {t.patientDetail.pageTitle}
    </Link>
  );
}

function formatLocation(ownerId: string | null | undefined): string | null {
  if (!ownerId) return null;
  if (looksLikeUuid(ownerId)) return t.appointmentsPage.linkedOwner;
  return ownerId;
}

function compactMeta(...parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(" \u2022 ");
}

function getTaskReasonBullets(scoreBreakdown: {
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

const USER_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

export default function AppointmentsPage() {
  const { userId, role, effectiveRole, isLoaded } = useAuth();
  const dir = useDirection();
  const resolvedRole = String(effectiveRole ?? role ?? "").trim().toLowerCase();
  const canCreateTask = isLoaded && resolvedRole !== "student";
  const queryClient = useQueryClient();
  const urgentRef = useRef<HTMLDivElement>(null);
  const myTasksRef = useRef<HTMLDivElement>(null);
  const bookingFormId = useId();
  const [day, setDay] = useState<string>(todayIsoDate());
  const [selectedVetId, setSelectedVetId] = useState<string>("");
  const [bookingOpen, setBookingOpen] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [pendingConflictPayload, setPendingConflictPayload] = useState<CreateAppointmentRequest | null>(null);
  const [conflictReason, setConflictReason] = useState("");

  const [formVetId, setFormVetId] = useState("");
  const [formAnimalId, setFormAnimalId] = useState("");
  const [formOwnerId, setFormOwnerId] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formTaskType, setFormTaskType] = useState<Appointment["taskType"]>("maintenance");
  const [formStartLocal, setFormStartLocal] = useState<string>(() => toLocalDateTimeInputValue(new Date()));
  const [formEndLocal, setFormEndLocal] = useState<string>(() => toLocalDateTimeInputValue(new Date(Date.now() + 20 * 60 * 1000)));
  const [selectedDuration, setSelectedDuration] = useState<number>(20);
  const [manualEndOverride, setManualEndOverride] = useState(false);

  const meQuery = useQuery({
    queryKey: ["/api/users/me"],
    queryFn: api.users.me,
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const meUserId = meQuery.data?.id;

  const metaQuery = useQuery({
    queryKey: ["/api/appointments/meta", day],
    queryFn: () => api.appointments.meta(day),
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!selectedVetId && meQuery.data?.id) {
      setSelectedVetId(meQuery.data.id);
    }
    if (!formVetId && meQuery.data?.id) {
      setFormVetId(meQuery.data.id);
    }
  }, [meQuery.data?.id, selectedVetId, formVetId]);

  useEffect(() => {
    if (!manualEndOverride) {
      const computedEnd = new Date(new Date(formStartLocal).getTime() + selectedDuration * 60 * 1000);
      setFormEndLocal(toLocalDateTimeInputValue(computedEnd));
    }
  }, [formStartLocal, selectedDuration, manualEndOverride]);

  const listQuery = useQuery({
    queryKey: ["/api/appointments", day],
    queryFn: () => api.appointments.list({ day }),
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const dashboardQuery = useQuery({
    queryKey: ["/api/tasks/dashboard", meUserId ?? ""],
    queryFn: () => api.tasks.dashboard(),
    enabled: Boolean(meUserId),
    refetchInterval: leaderPoll(90_000),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
    retry: false,
  });
  const recommendationsQuery = useTaskRecommendations(Boolean(userId) && Boolean(meUserId));

  const vetNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const vet of metaQuery.data?.vets ?? []) {
      map.set(vet.id, vet.displayName || vet.name);
    }
    return map;
  }, [metaQuery.data?.vets]);

  function resolveVet(vetId: string | null | undefined): string {
    if (!vetId) return t.appointmentsPage.unassigned;
    return vetNameMap.get(vetId) ?? t.appointmentsPage.staffMember;
  }

  const createMutation = useMutation({
    mutationFn: (payload: CreateAppointmentRequest) => api.appointments.create(payload),
    onSuccess: () => {
      toast.success(t.appointmentsPage.taskCreated);
      queryClient.invalidateQueries({ queryKey: ["/api/appointments", day], exact: true });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/dashboard", meUserId ?? ""], exact: true });
      setBookingOpen(false);
      setFormNotes("");
      setFormAnimalId("");
      setFormOwnerId("");
      setFormTaskType("maintenance");
    },
    onError: (error: Error) => {
      if (error.message === "APPOINTMENT_CONFLICT") {
        const payload: CreateAppointmentRequest = {
          vetId: formVetId.trim(),
          animalId: formAnimalId.trim() || null,
          ownerId: formOwnerId.trim() || null,
          startTime: new Date(formStartLocal).toISOString(),
          endTime: new Date(formEndLocal).toISOString(),
          notes: formNotes.trim() || null,
          status: "scheduled",
        };
        setPendingConflictPayload(payload);
        setConflictReason("");
        setConflictOpen(true);
        return;
      }
      toast.error(toErrorMessage(error));
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: AppointmentStatus }) =>
      api.appointments.update(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/appointments", day], exact: true });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/dashboard", meUserId ?? ""], exact: true });
    },
    onError: (error: Error) => {
      toast.error(toErrorMessage(error));
    },
  });

  const startTaskMutation = useMutation({
    mutationFn: (id: string) => api.tasks.start(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/appointments", day], exact: true });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/dashboard", meUserId ?? ""], exact: true });
      // Phase 6 PR 6.4 light adoption (2 of 2): canonical client toast wrapper +
      // extract the Hebrew literal to locale dict. Full appointments.tsx
      // migration lands in PR 6.8.
      toastSuccess(t.appointmentsPage.toast.taskStarted);
    },
    onError: (error: Error) => {
      toast.error(toErrorMessage(error));
    },
  });

  const completeTaskMutation = useMutation({
    mutationFn: (id: string) => api.tasks.complete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/appointments", day], exact: true });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/dashboard", meUserId ?? ""], exact: true });
      toast.success(t.appointmentsPage.toast.taskCompleted);
    },
    onError: (error: Error) => {
      toast.error(toErrorMessage(error));
    },
  });

  const handleRealtimeEvent = useCallback((event: { type: string; payload: unknown }) => {
    if (
      event.type === "TASK_CREATED" ||
      event.type === "TASK_STARTED" ||
      event.type === "TASK_COMPLETED" ||
      event.type === "TASK_UPDATED"
    ) {
      queryClient.invalidateQueries({ queryKey: ["/api/appointments", day], exact: true });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/dashboard", meUserId ?? ""], exact: true });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/recommendations"], exact: true });
      return;
    }
    if (event.type === "AUTOMATION_TRIGGERED") {
      toast.info(t.appointmentsPage.toast.autoUpdated);
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/dashboard", meUserId ?? ""], exact: true });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/recommendations"], exact: true });
      return;
    }
    if (event.type === "NOTIFICATION_SENT") return;
  }, [day, meUserId, queryClient]);

  useRealtime(handleRealtimeEvent);

  // Phase 9 PR 9.3 — visibility / pageshow / online / resume reconciliation.
  // Refetches ward/ER caches and lets `useRealtime` continue handling the
  // appointment-specific event flow.
  useRealtimeReconciliation({ queryClient });

  const filteredAppointments = useMemo(() => {
    const all = [...(listQuery.data ?? [])].sort((a, b) => {
      return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
    });
    if (!selectedVetId) return all;
    return all.filter((appointment) => appointment.vetId === selectedVetId);
  }, [listQuery.data, selectedVetId]);

  const appointmentBlocks = useMemo(() => {
    return filteredAppointments.map((appointment) => {
      const start = new Date(appointment.startTime);
      const end = new Date(appointment.endTime);
      const top = minutesSinceDayStart(day, start) * PIXELS_PER_MINUTE;
      const height = Math.max(24, (end.getTime() - start.getTime()) / 60000 * PIXELS_PER_MINUTE);
      return { appointment, top, height, start, end };
    });
  }, [filteredAppointments, day]);

  const appointmentStatusLabels = statusLabel();

  const totalGridMinutes = (DAY_END_HOUR - DAY_START_HOUR) * 60;
  const totalGridHeight = totalGridMinutes * PIXELS_PER_MINUTE;

  const slotStarts = useMemo(() => {
    const slots: Date[] = [];
    for (let mins = DAY_START_HOUR * 60; mins < DAY_END_HOUR * 60; mins += SLOT_MINUTES) {
      slots.push(dateAtLocalDay(day, Math.floor(mins / 60), mins % 60));
    }
    return slots;
  }, [day]);

  const selectedVetMeta = useMemo(
    () => metaQuery.data?.vets.find((vet) => vet.id === selectedVetId) ?? null,
    [metaQuery.data?.vets, selectedVetId],
  );

  const availableIntervals = useMemo(() => {
    const shifts = selectedVetMeta?.shifts ?? [];
    return shifts.map((shift) => ({
      start: shift.startTime.slice(0, 5),
      end: shift.endTime.slice(0, 5),
    }));
  }, [selectedVetMeta?.shifts]);

  const slotAvailability = useMemo(() => {
    if (!selectedVetId) {
      return slotStarts.map((slot) => ({ slot, available: true }));
    }
    return slotStarts.map((slot) => {
      const hhmm = `${String(slot.getHours()).padStart(2, "0")}:${String(slot.getMinutes()).padStart(2, "0")}`;
      const available = availableIntervals.some((window) => hhmm >= window.start && hhmm < window.end);
      return { slot, available };
    });
  }, [slotStarts, availableIntervals, selectedVetId]);

  function openQuickBooking(slotDate: Date) {
    const start = slotDate;
    const end = new Date(start.getTime() + selectedDuration * 60 * 1000);
    setFormStartLocal(toLocalDateTimeInputValue(start));
    setFormEndLocal(toLocalDateTimeInputValue(end));
    setManualEndOverride(false);
    setFormVetId(selectedVetId || formVetId || meQuery.data?.id || "");
    setBookingOpen(true);
  }

  function submitCreate(conflictOverride = false, overrideReason?: string) {
    if (!formVetId.trim()) {
      toast.error(t.appointmentsPage.toast.errorPickTechnician);
      return;
    }
    if (!formAnimalId.trim()) {
      toast.error(t.appointmentsPage.toast.errorPickDevice);
      return;
    }

    const start = new Date(formStartLocal);
    const end = new Date(formEndLocal);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      toast.error(t.appointmentsPage.toast.errorValidStartEnd);
      return;
    }
    if (end.getTime() <= start.getTime()) {
      toast.error(t.appointmentsPage.toast.errorEndAfterStart);
      return;
    }

    const payload: CreateAppointmentRequest = {
      vetId: formVetId.trim(),
      animalId: formAnimalId.trim() || null,
      ownerId: formOwnerId.trim() || null,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      notes: formNotes.trim() || null,
      status: "scheduled",
      taskType: formTaskType,
      scheduledAt: start.toISOString(),
      conflictOverride,
      overrideReason: overrideReason?.trim() || null,
    };
    createMutation.mutate(payload);
  }

  // Students have no access to appointments; redirect to equipment.
  if (isLoaded && resolvedRole === "student") {
    return <Redirect to="/equipment" replace />;
  }

  const TASKS_SIDEBAR: SidebarItem[] = [
    { href: "/appointments", icon: CalendarDays, label: t.appointmentsPage.tasks },
  ];

  const pageContent = (
    <>
      <div dir={dir} className="flex flex-col gap-4 pb-24 text-start">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CalendarDays className="w-6 h-6" />
            {t.appointmentsPage.tasks}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t.appointmentsPage.pageSubtitle}
          </p>
        </div>

        <Card className="bg-card border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">{t.appointmentsPage.nextTaskCardTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            {recommendationsQuery.isError ? (
              <ErrorCard
                message={t.appointmentsPage.recommendationsLoadFailed}
                onRetry={() => recommendationsQuery.refetch()}
              />
            ) : recommendationsQuery.isLoading && !recommendationsQuery.data ? (
              <LoadingSection rows={2} />
            ) : !recommendationsQuery.data?.nextBestTask ? (
              <EmptyState
                icon={CheckCircle2}
                message={t.appointmentsPage.allCaughtUp}
                subMessage={t.appointmentsPage.noPendingTasks}
                action={canCreateTask ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 px-3 text-xs"
                    onClick={() => openQuickBooking(new Date())}
                  >
                    <Plus className="w-3.5 h-3.5 me-1" />
                    {t.appointmentsPage.createTask}
                  </Button>
                ) : undefined}
              />
            ) : (() => {
              const nbt = recommendationsQuery.data.nextBestTask;
              const nbtCompleteState = completeButtonState({
                appointment: nbt,
                meId: meQuery.data?.id,
                meClerkId: meQuery.data?.clerkId,
                role: meQuery.data?.role,
                effectiveRole: meQuery.data?.effectiveRole,
              });
              const timeRange = `${formatTimeHHMM(new Date(nbt.startTime))}\u2009\u2013\u2009${formatTimeHHMM(new Date(nbt.endTime))}`;
              return (
                <div className="rounded-xl border border-border/70 p-4 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-semibold">{formatDevice(nbt.animalId)}</div>
                        <PatientChartLink animalId={nbt.animalId} />
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {compactMeta(formatLocation(nbt.ownerId), resolveVet(nbt.vetId), timeRange)}
                      </div>
                      {formatScheduledLabel(nbt) ? (
                        <div className="text-xs text-muted-foreground mt-1">
                          {formatScheduledLabel(nbt)}
                        </div>
                      ) : null}
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${PRIORITY_COLORS[nbt.priority ?? "normal"]}`}
                    >
                      {priorityLabel(nbt.priority)}
                    </Badge>
                  </div>

                  <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                    <div className="text-xs font-semibold text-foreground mb-2">Why this task?</div>
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {getTaskReasonBullets(nbt.scoreBreakdown).map((reason) => (
                        <li key={reason}>{"\u2022"} {reason}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {canStartTask(nbt, meQuery.data?.id, role, effectiveRole) ? (
                      <Button
                        size="sm"
                        variant="default"
                        className={ACTION_BUTTON_BASE}
                        disabled={startTaskMutation.isPending}
                        onClick={() => startTaskMutation.mutate(nbt.id)}
                      >
                        {t.appointmentsPage.startNow}
                      </Button>
                    ) : null}
                    {nbtCompleteState.visible ? (
                      <ActionTooltip content={nbtCompleteState.disabled ? nbtCompleteState.tooltip : undefined}>
                        <Button
                          size="sm"
                          variant="secondary"
                          className={ACTION_BUTTON_BASE}
                          disabled={completeTaskMutation.isPending || nbtCompleteState.disabled}
                          onClick={() => completeTaskMutation.mutate(nbt.id)}
                        >
                          {t.appointmentsPage.markComplete}
                        </Button>
                      </ActionTooltip>
                    ) : null}
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>

        <Card ref={urgentRef} className="bg-card border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">{t.appointmentsPage.urgent}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {dashboardQuery.isError ? (
              <ErrorCard
                message={t.appointmentsPage.urgentLoadFailed}
                onRetry={() => dashboardQuery.refetch()}
              />
            ) : dashboardQuery.isLoading && !dashboardQuery.data ? (
              <LoadingSection rows={2} />
            ) : (
              <>
                <ul className="space-y-2">
                  {(dashboardQuery.data?.overdue ?? []).map((overdueItem) => (
                    <li key={overdueItem.id} className={`rounded-lg border p-3 text-sm ${TASK_CARD_STYLES.overdue}`}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                          <span className="font-semibold min-w-0 flex-1 break-words">{formatDevice(overdueItem.animalId)}</span>
                          <PatientChartLink animalId={overdueItem.animalId} />
                        </div>
                        <Badge variant="outline" className={URGENT_BADGE_STYLES.overdue}>
                          overdue
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {compactMeta(
                          formatLocation(overdueItem.ownerId),
                          resolveVet(overdueItem.vetId),
                          `${formatTimeHHMM(new Date(overdueItem.startTime))}\u2009\u2013\u2009${formatTimeHHMM(new Date(overdueItem.endTime))}`,
                        )}
                      </div>
                      {formatScheduledLabel(overdueItem) ? (
                        <div className="text-xs text-muted-foreground mt-1">
                          {formatScheduledLabel(overdueItem)}
                        </div>
                      ) : null}
                    </li>
                  ))}
                  {(recommendationsQuery.data?.urgentTasks ?? []).map((urgentItem) => (
                    <li key={`urgent-${urgentItem.id}`} className={`rounded-lg border p-3 text-sm ${TASK_CARD_STYLES.critical}`}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                          <span className="font-semibold min-w-0 flex-1 break-words">{formatDevice(urgentItem.animalId)}</span>
                          <PatientChartLink animalId={urgentItem.animalId} />
                        </div>
                        <Badge variant="outline" className={URGENT_BADGE_STYLES.critical}>
                          critical
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {compactMeta(
                          formatLocation(urgentItem.ownerId),
                          resolveVet(urgentItem.vetId),
                          `${formatTimeHHMM(new Date(urgentItem.startTime))}\u2009\u2013\u2009${formatTimeHHMM(new Date(urgentItem.endTime))}`,
                        )}
                      </div>
                      {formatScheduledLabel(urgentItem) ? (
                        <div className="text-xs text-muted-foreground mt-1">
                          {formatScheduledLabel(urgentItem)}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {(dashboardQuery.data?.overdue.length ?? 0) === 0 && (recommendationsQuery.data?.urgentTasks.length ?? 0) === 0 ? (
                  <EmptyState
                    icon={CheckCircle2}
                    message={t.appointmentsPage.empty.urgentTitle}
                    subMessage={t.appointmentsPage.empty.urgentHint}
                  action={(
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-3 text-xs"
                      onClick={() => myTasksRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                    >
                      {t.appointmentsPage.viewMyTasks}
                    </Button>
                  )}
                  />
                ) : null}
              </>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="bg-card border-border/60 shadow-sm">
            <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
              <Zap className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />
              <CardTitle className="text-sm font-semibold">
                Today
                {dashboardQuery.data ? (
                  <span className="text-muted-foreground font-normal"> ({dashboardQuery.data.counts.today})</span>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 max-h-[min(320px,45vh)] overflow-y-auto">
              {dashboardQuery.isError ? (
                <ErrorCard
                  message={t.appointmentsPage.todayLoadFailed}
                  onRetry={() => dashboardQuery.refetch()}
                />
              ) : dashboardQuery.isLoading && !dashboardQuery.data ? (
                <LoadingSection rows={2} />
              ) : (dashboardQuery.data?.today.length ?? 0) === 0 ? (
                <EmptyState
                  icon={CheckCircle2}
                  message={t.appointmentsPage.allCaughtUp}
                  subMessage={t.appointmentsPage.noTasksToday}
                  action={canCreateTask ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-3 text-xs"
                      onClick={() => openQuickBooking(new Date())}
                    >
                      <Plus className="w-3.5 h-3.5 me-1" />
                      {t.appointmentsPage.createTask}
                    </Button>
                  ) : undefined}
                />
              ) : (
                <ul className="space-y-2">
                  {dashboardQuery.data!.today.map((todayTask) => {
                    const completeState = completeButtonState({
                      appointment: todayTask,
                      meId: meQuery.data?.id,
                      meClerkId: meQuery.data?.clerkId,
                      role: meQuery.data?.role,
                      effectiveRole: meQuery.data?.effectiveRole,
                    });
                    return (
                    <li key={todayTask.id} className={`flex flex-col gap-1.5 rounded-lg border p-3 text-sm ${TASK_CARD_STYLES.soon}`}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                          <span className="font-semibold min-w-0 flex-1 break-words">{formatDevice(todayTask.animalId)}</span>
                          <PatientChartLink animalId={todayTask.animalId} />
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-1 shrink-0">
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${PRIORITY_COLORS[todayTask.priority ?? "normal"]}`}
                          >
                            {priorityLabel(todayTask.priority)}
                          </Badge>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {compactMeta(
                          formatLocation(todayTask.ownerId),
                          resolveVet(todayTask.vetId),
                          `${formatTimeHHMM(new Date(todayTask.startTime))}\u2009\u2013\u2009${formatTimeHHMM(new Date(todayTask.endTime))}`,
                        )}
                      </div>
                      {formatScheduledLabel(todayTask) ? (
                        <div className="text-xs text-muted-foreground mt-1">
                          {formatScheduledLabel(todayTask)}
                        </div>
                      ) : null}
                      <div className="flex flex-wrap gap-2 mt-1">
                        {canStartTask(todayTask, meQuery.data?.id, role, effectiveRole) ? (
                          <Button
                            size="sm"
                            variant="default"
                            className={ACTION_BUTTON_BASE}
                            disabled={startTaskMutation.isPending}
                            onClick={() => startTaskMutation.mutate(todayTask.id)}
                          >
                            {t.appointmentsPage.startNow}
                          </Button>
                        ) : null}
                        {completeState.visible ? (
                          <ActionTooltip content={completeState.disabled ? completeState.tooltip : undefined}>
                            <Button
                              size="sm"
                              variant="secondary"
                              className={ACTION_BUTTON_BASE}
                              disabled={completeTaskMutation.isPending || completeState.disabled}
                              onClick={() => completeTaskMutation.mutate(todayTask.id)}
                            >
                              {t.appointmentsPage.markComplete}
                            </Button>
                          </ActionTooltip>
                        ) : null}
                      </div>
                    </li>
                  );})}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card ref={myTasksRef} className="bg-card border-border/60 shadow-sm">
            <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
              <User className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />
              <CardTitle className="text-sm font-semibold">
                {t.appointmentsPage.myTasksTitle}
                {dashboardQuery.data ? (
                  <span className="text-muted-foreground font-normal"> ({dashboardQuery.data.counts.myTasks})</span>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 max-h-[min(320px,45vh)] overflow-y-auto">
              {dashboardQuery.isError ? (
                <ErrorCard
                  message={t.appointmentsPage.myTasksLoadFailed}
                  onRetry={() => dashboardQuery.refetch()}
                />
              ) : dashboardQuery.isLoading && !dashboardQuery.data ? (
                <LoadingSection rows={2} />
              ) : (dashboardQuery.data?.myTasks.length ?? 0) === 0 ? (
                <EmptyState
                  icon={CheckCircle2}
                  message={t.appointmentsPage.empty.myTitle}
                  subMessage={t.appointmentsPage.empty.myHint}
                  action={(
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-3 text-xs"
                      onClick={() => urgentRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                    >
                      {t.appointmentsPage.statusAction.reviewUrgent}
                    </Button>
                  )}
                />
              ) : (
                <ul className="space-y-2">
                  {dashboardQuery.data!.myTasks.map((myTask) => {
                    const completeState = completeButtonState({
                      appointment: myTask,
                      meId: meQuery.data?.id,
                      meClerkId: meQuery.data?.clerkId,
                      role: meQuery.data?.role,
                      effectiveRole: meQuery.data?.effectiveRole,
                    });
                    return (
                    <li key={myTask.id} className={`flex flex-col gap-1.5 rounded-lg border p-3 text-sm ${TASK_CARD_STYLES.normal}`}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                          <span className="font-semibold min-w-0 flex-1 break-words">{formatDevice(myTask.animalId)}</span>
                          <PatientChartLink animalId={myTask.animalId} />
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-1 shrink-0">
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${PRIORITY_COLORS[myTask.priority ?? "normal"]}`}
                          >
                            {priorityLabel(myTask.priority)}
                          </Badge>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {compactMeta(
                          formatLocation(myTask.ownerId),
                          resolveVet(myTask.vetId),
                          `${formatTimeHHMM(new Date(myTask.startTime))}\u2009\u2013\u2009${formatTimeHHMM(new Date(myTask.endTime))}`,
                        )}
                      </div>
                      {formatScheduledLabel(myTask) ? (
                        <div className="text-xs text-muted-foreground mt-1">
                          {formatScheduledLabel(myTask)}
                        </div>
                      ) : null}
                      <div className="flex flex-wrap gap-2 mt-1">
                        {canStartTask(myTask, meQuery.data?.id, role, effectiveRole) ? (
                          <Button
                            size="sm"
                            variant="default"
                            className={ACTION_BUTTON_BASE}
                            disabled={startTaskMutation.isPending}
                            onClick={() => startTaskMutation.mutate(myTask.id)}
                          >
                            {t.appointmentsPage.startNow}
                          </Button>
                        ) : null}
                        {completeState.visible ? (
                          <ActionTooltip content={completeState.disabled ? completeState.tooltip : undefined}>
                            <Button
                              size="sm"
                              variant="secondary"
                              className={ACTION_BUTTON_BASE}
                              disabled={completeTaskMutation.isPending || completeState.disabled}
                              onClick={() => completeTaskMutation.mutate(myTask.id)}
                            >
                              {t.appointmentsPage.markComplete}
                            </Button>
                          </ActionTooltip>
                        ) : null}
                      </div>
                    </li>
                  );})}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="bg-card border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">{t.appointmentsPage.suggestions}</CardTitle>
          </CardHeader>
          <CardContent>
            {recommendationsQuery.isLoading && !recommendationsQuery.data ? (
              <LoadingSection rows={2} />
            ) : (recommendationsQuery.data?.suggestions.length ?? 0) === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                message={t.appointmentsPage.empty.suggestionsTitle}
                subMessage={t.appointmentsPage.empty.suggestionsHint}
                action={canCreateTask ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 px-3 text-xs"
                    onClick={() => openQuickBooking(new Date())}
                  >
                    <Plus className="w-3.5 h-3.5 me-1" />
                    {t.appointmentsPage.createTask}
                  </Button>
                ) : undefined}
              />
            ) : (
              <ul className="space-y-2">
                {recommendationsQuery.data?.suggestions.map((suggestion, idx) => (
                  <li
                    key={`${suggestion.type}-${idx}`}
                    className={`rounded-md border p-3 text-sm ${SUGGESTION_SEVERITY_STYLES[suggestion.severity]}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        {suggestion.type === "OVERDUE_WARNING"
                          ? t.appointmentsPage.statusHint.overdue(dashboardQuery.data?.counts.overdue ?? 0)
                          : suggestion.type === "START_NOW"
                            ? t.appointmentsPage.statusHint.startNow
                            : suggestion.type === "OVERLOADED"
                              ? t.appointmentsPage.statusHint.overloaded
                              : t.appointmentsPage.statusHint.pickFromQueue}
                      </span>
                      <Button
                        size="sm"
                        variant="secondary"
                        className={ACTION_BUTTON_BASE}
                        onClick={() => {
                          if (suggestion.type === "START_NOW" && recommendationsQuery.data?.nextBestTask) {
                            startTaskMutation.mutate(recommendationsQuery.data.nextBestTask.id);
                          } else if (suggestion.type === "OVERDUE_WARNING" || suggestion.type === "OVERLOADED") {
                            urgentRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                          } else if (suggestion.type === "PICK_FROM_QUEUE") {
                            myTasksRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                          }
                        }}
                      >
                        {suggestion.type === "START_NOW"
                          ? t.appointmentsPage.startNow
                            : suggestion.type === "PICK_FROM_QUEUE"
                            ? t.appointmentsPage.statusAction.viewQueue
                              : t.appointmentsPage.statusAction.reviewUrgent}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border/60 shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Plus className="w-4 h-4" />
              {t.appointmentsPage.taskControls}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 items-end">
            <div className="min-w-0">
              <label htmlFor={`${bookingFormId}-filter-day`} className="text-xs text-muted-foreground block text-end mb-1">{t.appointmentsPage.dayLabel}</label>
              <Input id={`${bookingFormId}-filter-day`} dir="ltr" className="text-left w-full max-w-full" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
            </div>
            <div className="min-w-0">
              <label htmlFor={`${bookingFormId}-filter-tech`} className="text-xs text-muted-foreground block text-end mb-1">{t.appointmentsPage.technicianFilter}</label>
              <select
                id={`${bookingFormId}-filter-tech`}
                dir="ltr"
                value={selectedVetId}
                onChange={(e) => setSelectedVetId(e.target.value)}
                className="h-10 w-full min-w-0 max-w-full rounded-md border border-input bg-background px-3 text-sm text-left truncate"
              >
                <option value="">{t.appointmentsPage.allTechnicians}</option>
                {(metaQuery.data?.vets ?? []).map((vet) => (
                  <option key={vet.id} value={vet.id}>
                    {vet.displayName || vet.name || t.appointmentsPage.unknownUser}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-0">
              <label className="text-xs text-muted-foreground block text-end mb-1">{t.appointmentsPage.hours}</label>
              <div dir="ltr" className="h-10 w-full px-3 rounded-md border flex items-center justify-start text-sm whitespace-nowrap">
                {String(DAY_START_HOUR).padStart(2, "0")}:00 – {String(DAY_END_HOUR).padStart(2, "0")}:00
              </div>
            </div>
            <div className="min-w-0">
              <label className="text-xs text-muted-foreground block text-end mb-1">{t.appointmentsPage.interval}</label>
              <div dir="ltr" className="h-10 w-full px-3 rounded-md border flex items-center text-sm">{t.appointmentsPage.minutesShort(SLOT_MINUTES)}</div>
            </div>
            {canCreateTask && (
              <div className="col-span-1 sm:col-span-2">
                <Button className="w-full" onClick={() => openQuickBooking(new Date())}>
                  <Plus className="w-4 h-4 me-1" />
                  {t.appointmentsPage.quickTask}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border/60 shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Clock3 className="w-4 h-4" />
              {t.appointmentsPage.dayView}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {selectedVetMeta ? (
              <div className="text-xs text-muted-foreground">
                {t.appointmentsPage.shiftWindowsFor(selectedVetMeta.displayName || selectedVetMeta.name)}{" "}
                {selectedVetMeta.shifts.length > 0
                  ? selectedVetMeta.shifts.map((s) => `${s.startTime.slice(0, 5)}-${s.endTime.slice(0, 5)}`).join(", ")
                  : t.appointmentsPage.noShiftImported}
              </div>
            ) : null}
            {listQuery.isError ? (
              <ErrorCard
                message={t.appointmentsPage.dayViewLoadFailed}
                onRetry={() => {
                  void listQuery.refetch();
                  void metaQuery.refetch();
                }}
              />
            ) : listQuery.isLoading ? (
              <LoadingSection rows={3} />
            ) : (
              <div className="relative border rounded-xl overflow-hidden">
                <div className="max-h-[70vh] overflow-auto">
                  <div className="relative" style={{ height: `${Math.max(totalGridHeight, HOUR_ROW_HEIGHT * (DAY_END_HOUR - DAY_START_HOUR))}px` }}>
                    {Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }).map((_, idx) => {
                      const hour = DAY_START_HOUR + idx;
                      const y = idx * 60 * PIXELS_PER_MINUTE;
                      return (
                        <div key={hour} className="absolute inset-x-0 border-t border-dashed border-border/70" style={{ top: y }}>
                          <span className="absolute -top-2 start-2 text-[10px] text-muted-foreground bg-background px-1">
                            {String(hour).padStart(2, "0")}:00
                          </span>
                        </div>
                      );
                    })}

                    {canCreateTask
                      ? (
                        <>
                          {slotAvailability.map(({ slot, available }) => {
                            const top = minutesSinceDayStart(day, slot) * PIXELS_PER_MINUTE;
                            return (
                              <button
                                key={slot.toISOString()}
                                type="button"
                                disabled={!available}
                                onKeyDown={(e) => {
                                  if ((e.key === "Enter" || e.key === " ") && available) {
                                    e.preventDefault();
                                    openQuickBooking(slot);
                                  }
                                }}
                                className={`absolute inset-x-0 border-t pointer-events-none ${
                                  available ? "focus:bg-emerald-50/80" : "bg-muted/40"
                                }`}
                                style={{ top, height: SLOT_MINUTES * PIXELS_PER_MINUTE }}
                                aria-label={`${t.appointmentsPage.scheduleTaskAt} ${formatTimeHHMM(slot)}`}
                              />
                            );
                          })}
                          {/* Single hit target: one DOM box covers the full grid so no slot
                              buttons overlap. Click Y is divided back into slot index. */}
                          <div
                            aria-hidden="true"
                            className="absolute inset-0 cursor-pointer"
                            onClick={(e) => {
                              const rect = e.currentTarget.getBoundingClientRect();
                              const y = e.clientY - rect.top;
                              const slotIndex = Math.floor(y / PIXELS_PER_MINUTE / SLOT_MINUTES);
                              const entry = slotAvailability[slotIndex];
                              if (entry?.available) openQuickBooking(entry.slot);
                            }}
                          />
                        </>
                      )
                      : isLoaded && (
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <span className="text-xs text-muted-foreground bg-background/80 px-3 py-1 rounded-full">
                              {t.appointmentsPage.dayViewReadOnly}
                            </span>
                          </div>
                        )}

                    {appointmentBlocks.map(({ appointment, top, height, start, end }) => {
                      const completeState = completeButtonState({
                        appointment,
                        meId: meQuery.data?.id,
                        meClerkId: meQuery.data?.clerkId,
                        role: meQuery.data?.role,
                        effectiveRole: meQuery.data?.effectiveRole,
                      });
                      return (
                      <div
                        key={appointment.id}
                        className={`absolute start-16 sm:start-24 end-3 rounded-lg border shadow-sm p-2 ${STATUS_COLORS[appointment.status]}`}
                        style={{ top: top + 1, height }}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-xs font-semibold break-words">
                            <span className="min-w-0">{formatDevice(appointment.animalId)}</span>
                            <PatientChartLink animalId={appointment.animalId} />
                          </div>
                          <div className="flex flex-wrap justify-end gap-1 shrink-0">
                            <Badge variant="secondary" className="text-[10px]">
                              {appointmentStatusLabels[appointment.status]}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${PRIORITY_BADGE[appointment.priority ?? "normal"] ?? PRIORITY_BADGE.normal}`}
                            >
                              {priorityLabel(appointment.priority)}
                            </Badge>
                          </div>
                        </div>
                        <div className="text-[11px] mt-1 truncate text-muted-foreground">
                          {compactMeta(
                            formatLocation(appointment.ownerId),
                            resolveVet(appointment.vetId),
                            `${formatTimeHHMM(start)}\u2009\u2013\u2009${formatTimeHHMM(end)}`,
                          )}
                        </div>
                        {formatScheduledLabel(appointment) ? (
                          <div className="text-[11px] mt-1 truncate text-muted-foreground">
                            {formatScheduledLabel(appointment)}
                          </div>
                        ) : null}
                        {appointment.conflictOverride ? (
                          <div className="text-[10px] mt-1 font-medium">{t.appointmentsPage.overrideApplied}</div>
                        ) : null}
                        <div className="flex gap-1 mt-2 flex-wrap">
                          {canStartTask(appointment, meQuery.data?.id, role, effectiveRole) ? (
                            <Button
                              size="sm"
                              variant="default"
                              className="h-7 text-[11px] px-2"
                              disabled={startTaskMutation.isPending}
                              onClick={() => startTaskMutation.mutate(appointment.id)}
                            >
                              {t.appointmentsPage.startNow}
                            </Button>
                          ) : null}
                          {completeState.visible ? (
                            <ActionTooltip content={completeState.disabled ? completeState.tooltip : undefined}>
                              <Button
                                size="sm"
                                variant="secondary"
                                className="h-7 text-[11px] px-2"
                                disabled={completeTaskMutation.isPending || completeState.disabled}
                                onClick={() => completeTaskMutation.mutate(appointment.id)}
                              >
                                {t.appointmentsPage.markComplete}
                              </Button>
                            </ActionTooltip>
                          ) : null}
                          {statusActions(appointment.status).map((nextStatus) => (
                            <Button
                              key={`${appointment.id}-${nextStatus}`}
                              size="sm"
                              variant="outline"
                              className="h-7 text-[11px] px-2"
                              onClick={() => updateStatusMutation.mutate({ id: appointment.id, status: nextStatus })}
                              disabled={updateStatusMutation.isPending}
                            >
                              {appointmentStatusLabels[nextStatus]}
                            </Button>
                          ))}
                        </div>
                      </div>
                    );})}

                    {appointmentBlocks.length === 0 ? (
                      <div className="absolute inset-0 flex items-center justify-center px-4">
                        <div className="w-full max-w-md">
                          <EmptyState
                            icon={CheckCircle2}
                            message={t.appointmentsPage.dayViewEmpty}
                            subMessage={t.appointmentsPage.dayViewEmptyHint}
                            action={canCreateTask ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 px-3 text-xs"
                                onClick={() => openQuickBooking(new Date())}
                              >
                                <Plus className="w-3.5 h-3.5 me-1" />
                                {t.appointmentsPage.createTask}
                              </Button>
                            ) : undefined}
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={bookingOpen} onOpenChange={setBookingOpen}>
        <DialogContent dir={dir} className="text-start max-h-[85dvh] flex flex-col overflow-hidden p-0">
          <DialogHeader className="shrink-0 px-6 pt-6">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1 space-y-1 text-start">
                <DialogTitle>{t.appointmentsPage.newTask}</DialogTitle>
                <DialogDescription>
                      {t.appointmentsPage.dialogDescTask}{" "}
                      <span dir="ltr" className="inline-block">
                        {t.appointmentsPage.dialogDescTapSlot}
                      </span>
                    </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
    <div>
      <label htmlFor={`${bookingFormId}-vet`} className="text-xs text-muted-foreground block text-start">
        {t.appointmentsPage.labelTechnician} <span className="text-destructive" aria-hidden>*</span>
      </label>
      <select
        id={`${bookingFormId}-vet`}
        dir="ltr"
        value={formVetId}
        onChange={(e) => setFormVetId(e.target.value)}
        required
        aria-required="true"
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="">{t.appointmentsPage.placeholderSelectTechnician}</option>
        {(metaQuery.data?.vets ?? []).map((vet) => (
          <option key={vet.id} value={vet.id}>
            {vet.displayName || vet.name || t.appointmentsPage.unknownUser}
          </option>
        ))}
      </select>
    </div>

    <div>
      <label htmlFor={`${bookingFormId}-asset`} className="text-xs text-muted-foreground block text-start">
        {t.appointmentsPage.labelDeviceAsset} <span className="text-destructive" aria-hidden>*</span>
      </label>
      <Input
        id={`${bookingFormId}-asset`}
        dir="ltr"
        className="text-left"
        value={formAnimalId}
        onChange={(e) => setFormAnimalId(e.target.value)}
        placeholder={t.appointmentsPage.placeholderDevice}
        required
        aria-required="true"
      />
    </div>

    <div>
      <label htmlFor={`${bookingFormId}-location`} className="text-xs text-muted-foreground block text-start">
        {t.appointmentsPage.labelLocation}
      </label>
      <Input
        id={`${bookingFormId}-location`}
        dir="ltr"
        className="text-left"
        value={formOwnerId}
        onChange={(e) => setFormOwnerId(e.target.value)}
        placeholder={t.appointmentsPage.placeholderLocation}
      />
    </div>

    <div>
      <label htmlFor={`${bookingFormId}-tasktype`} className="text-xs text-muted-foreground block text-start">{t.appointmentsPage.labelTaskType}</label>
      <select
        id={`${bookingFormId}-tasktype`}
        dir="ltr"
        value={formTaskType ?? "maintenance"}
        onChange={(e) => {
          const nextType = (e.target.value || "maintenance") as Appointment["taskType"];
          setFormTaskType(nextType);
        }}
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
      >
        {ALLOWED_BOOKING_TASK_TYPES().map((taskType) => (
          <option key={taskType.value} value={taskType.value}>
            {taskType.label}
          </option>
        ))}
      </select>
    </div>

    <div>
      <label htmlFor={`${bookingFormId}-duration`} className="text-xs text-muted-foreground block text-start">{t.appointmentsPage.taskDuration}</label>
      <select
        id={`${bookingFormId}-duration`}
        dir="ltr"
        value={String(selectedDuration)}
        onChange={(e) => {
          setSelectedDuration(Number.parseInt(e.target.value, 10));
          setManualEndOverride(false);
        }}
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
      >
        {DURATION_PRESETS().map((preset) => (
          <option key={preset.key} value={preset.minutes}>
            {preset.label}
          </option>
        ))}
      </select>
    </div>

    <div>
      <label htmlFor={`${bookingFormId}-start`} className="text-xs text-muted-foreground block text-start">
        {t.appointmentsPage.labelScheduledTime} <span className="text-muted-foreground/70">({USER_TIMEZONE})</span>
      </label>
      <Input
        id={`${bookingFormId}-start`}
        dir="ltr"
        className="text-left"
        type="datetime-local"
        value={formStartLocal}
        onChange={(e) => setFormStartLocal(e.target.value)}
      />
    </div>

    <div>
      <label htmlFor={`${bookingFormId}-end`} className="text-xs text-muted-foreground block text-start">{t.appointmentsPage.labelExpectedEnd}</label>
      <Input
        id={`${bookingFormId}-end`}
        dir="ltr"
        className="text-left"
        type="datetime-local"
        value={formEndLocal}
        onChange={(e) => {
          setManualEndOverride(true);
          setFormEndLocal(e.target.value);
        }}
      />
    </div>

    <div className="md:col-span-2">
      <label htmlFor={`${bookingFormId}-notes`} className="text-xs text-muted-foreground block text-start">{t.appointmentsPage.labelNotes}</label>
      <Textarea
        id={`${bookingFormId}-notes`}
        dir="ltr"
        className="text-left"
        value={formNotes}
        onChange={(e) => setFormNotes(e.target.value)}
        rows={3}
      />
    </div>
  </div>
          </div>
          <DialogFooter className="shrink-0 border-t bg-background px-6 py-4">
            <Button variant="outline" onClick={() => setBookingOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button
              onClick={() => submitCreate(false)}
              disabled={
                createMutation.isPending
                || !formVetId.trim()
                || !formAnimalId.trim()
                || !formStartLocal
                || !formEndLocal
              }
            >
              {createMutation.isPending ? t.appointmentsPage.saving : t.appointmentsPage.createTask}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={conflictOpen} onOpenChange={setConflictOpen}>
        <DialogContent dir={dir} className="text-start max-h-[85dvh] flex flex-col overflow-hidden p-0">
          <DialogHeader className="shrink-0 px-6 pt-6">
            <DialogTitle>{t.appointmentsPage.conflictTitle}</DialogTitle>
            <DialogDescription>
              {t.appointmentsPage.conflictBody}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
            <label className="text-xs text-muted-foreground block text-start">{t.appointmentsPage.overrideReason}</label>
            <Textarea dir="ltr" className="text-left" value={conflictReason} onChange={(e) => setConflictReason(e.target.value)} placeholder={t.appointmentsPage.overridePlaceholder} rows={3} />
          </div>
          <DialogFooter className="shrink-0 border-t bg-background px-6 py-4">
            <Button variant="outline" onClick={() => setConflictOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button
              onClick={() => {
                if (!pendingConflictPayload) return;
                createMutation.mutate({
                  ...pendingConflictPayload,
                  conflictOverride: true,
                  overrideReason: conflictReason.trim() || null,
                });
                setConflictOpen(false);
              }}
              disabled={!conflictReason.trim()}
            >
              {t.common.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
  return (
    <AppShell sidebarItems={TASKS_SIDEBAR} title={t.appointmentsPage.tasks}>
      {pageContent}
    </AppShell>
  );
}
