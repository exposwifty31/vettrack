import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Redirect } from "wouter";
import { t } from "@/lib/i18n";
import { CalendarDays, CheckCircle2, ChevronRight, Clock3, Plus, User, Zap } from "lucide-react";
import { Layout } from "@/components/layout";
import { PageShell } from "@/components/layout/PageShell";
import type { SidebarItem } from "@/components/layout/IconSidebar";
import { MedicationCalculator } from "@/components/MedicationCalculator";
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
import { useTaskRecommendations } from "@/hooks/useTaskRecommendations";
import { useAuth } from "@/hooks/use-auth";
import type { Appointment, AppointmentStatus, CreateAppointmentRequest, TaskPriority } from "@/types";
import { toast } from "sonner";

const DAY_START_HOUR = 8;
const DAY_END_HOUR = 20;
const SLOT_MINUTES = 15;
const PIXELS_PER_MINUTE = 1.2;
const HOUR_ROW_HEIGHT = 60;
const DASHBOARD_REFETCH_MS = 45_000;

const DURATION_PRESETS = [
  { key: "quick-inspection", label: "Quick inspection (10m)", minutes: 10 },
  { key: "urgent-response", label: "Urgent response (20m)", minutes: 20 },
  { key: "preventive-maintenance", label: "Preventive maintenance (30m)", minutes: 30 },
  { key: "repair-visit", label: "Repair visit (45m)", minutes: 45 },
  { key: "calibration", label: "Calibration (60m)", minutes: 60 },
] as const;

const ALLOWED_BOOKING_TASK_TYPES = [
  { value: "maintenance", label: "Maintenance" },
  { value: "repair", label: "Repair" },
  { value: "inspection", label: "Inspection" },
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

type MedicationMetadata = {
  createdBy?: string;
  acknowledgedBy?: string;
  prescribedByName?: string;
  doseJustification?: string;
  [key: string]: unknown;
};

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
  if (err.message === "APPOINTMENT_CONFLICT") return "This technician already has an overlapping task.";
  if (err.message === "OUTSIDE_SHIFT") return "Selected time is outside the technician shift.";
  if (err.message === "OVERRIDE_REASON_REQUIRED") return "Conflict override requires a reason.";
  if (err.message === "TIMEZONE_REQUIRED") return "Time input must include timezone information.";
  if (err.message === "UNAUTHORIZED" || err.message === "Session expired") return "Your session expired. Please sign in again.";
  if (err.message === "INSUFFICIENT_ROLE") return "You do not have permission to create or assign this task.";
  if (err.message === "VALIDATION_FAILED") return "Please review required fields and time values.";
  if (err.message === "TASK_NOT_OWNED_BY_TECH") return "Only the assigned technician can perform this action.";
  if (err.message === "TASK_NOT_ASSIGNED") return "Assign a technician before starting.";
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

function medicationMetadata(appointment: Appointment): MedicationMetadata | null {
  if (!appointment.metadata || typeof appointment.metadata !== "object") return null;
  return appointment.metadata as MedicationMetadata;
}

function getScheduledIso(appointment: Appointment): string | null {
  if (appointment.scheduledAt) return appointment.scheduledAt;
  const metadata = medicationMetadata(appointment);
  if (metadata && typeof metadata.scheduled_at === "string") return metadata.scheduled_at;
  return appointment.startTime ?? null;
}

function isDelayedMedicationTask(appointment: Appointment): boolean {
  if (appointment.taskType !== "medication") return false;
  if (appointment.status !== "pending") return false;
  const scheduledIso = getScheduledIso(appointment);
  if (!scheduledIso) return false;
  const scheduledMs = new Date(scheduledIso).getTime();
  if (!Number.isFinite(scheduledMs)) return false;
  return Date.now() > scheduledMs + 15 * 60 * 1000;
}

function formatScheduledLabel(appointment: Appointment): string | null {
  const scheduledIso = getScheduledIso(appointment);
  if (!scheduledIso) return null;
  return `Scheduled ${formatTimeHHMM(new Date(scheduledIso))}`;
}

function formatPrescribedByLabel(appointment: Appointment): string | null {
  if (appointment.taskType !== "medication") return null;
  const metadata = medicationMetadata(appointment);
  const prescribedByRaw = typeof metadata?.prescribedByName === "string"
    ? metadata.prescribedByName
    : typeof metadata?.createdBy === "string"
      ? metadata.createdBy
      : null;
  const prescribedBy = prescribedByRaw && !looksLikeUuid(prescribedByRaw)
    ? prescribedByRaw
    : "Staff member";
  if (!prescribedBy) return null;
  return `Prescribed by ${prescribedBy}`;
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

  if (appointment.taskType !== "medication") {
    return { visible: true, disabled: false, tooltip: "" };
  }

  const metadata = medicationMetadata(appointment);
  const acknowledgedBy = typeof metadata?.acknowledgedBy === "string" ? metadata.acknowledgedBy : "";
  const meUserId = (meId ?? "").trim();
  const meClerk = (meClerkId ?? "").trim();
  const isAcknowledgedOwner =
    !!acknowledgedBy &&
    (acknowledgedBy === meUserId || (meClerk.length > 0 && acknowledgedBy === meClerk));
  if (!isAcknowledgedOwner) {
    return {
      visible: true,
      disabled: true,
      tooltip: "Only the technician who acknowledged this task can complete it. Please contact the prescriber or admin for override.",
    };
  }

  return { visible: true, disabled: false, tooltip: "" };
}

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  pending: "ממתין",
  assigned: "הוקצה",
  scheduled: "מתוזמן",
  arrived: "הגיע",
  in_progress: "בביצוע",
  completed: "הושלם",
  cancelled: "בוטל",
  no_show: "לא הופיע",
};

function looksLikeUuid(s: string): boolean {
  return s.includes("-") && s.length > 20;
}

function formatDevice(animalId: string | null | undefined): string {
  if (!animalId) return "Unassigned device";
  if (looksLikeUuid(animalId)) return "Assigned device";
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
  if (looksLikeUuid(ownerId)) return "Assigned owner";
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
  if (scoreBreakdown.overdue > 0) bullets.push("Overdue");
  if (scoreBreakdown.critical > 0) bullets.push("Critical priority");
  if (scoreBreakdown.startsSoon > 0) bullets.push("Starting soon");
  if (scoreBreakdown.assigned > 0) bullets.push("Assigned to you");
  if (scoreBreakdown.inProgress > 0) bullets.push("Already in progress");
  return bullets;
}

function isMedicationNeedingApproval(appointment: Appointment): boolean {
  if (appointment.taskType !== "medication") return false;
  if (appointment.status !== "in_progress") return false;
  const meta = appointment.metadata;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return false;
  return (meta as Record<string, unknown>).vetApproved !== true;
}

function isVetOrAdmin(role: string | null | undefined, effectiveRole: string | null | undefined): boolean {
  const r = String(effectiveRole ?? role ?? "").trim().toLowerCase();
  return r === "vet" || r === "admin";
}

const USER_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

export default function AppointmentsPage() {
  const { userId, role, effectiveRole, isLoaded } = useAuth();
  const resolvedRole = String(effectiveRole ?? role ?? "").trim().toLowerCase();
  const canCreateTask = resolvedRole !== "student";
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

  const isMedicationForm = formTaskType === "medication";

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
    if (!vetId) return "Unassigned";
    return vetNameMap.get(vetId) ?? "Staff member";
  }

  const createMutation = useMutation({
    mutationFn: (payload: CreateAppointmentRequest) => api.appointments.create(payload),
    onSuccess: () => {
      toast.success("משימה נוצרה");
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
      toast.success("משימה התחילה");
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
      toast.success("משימה הושלמה");
    },
    onError: (error: Error) => {
      toast.error(toErrorMessage(error));
    },
  });

  const vetApproveMutation = useMutation({
    mutationFn: (id: string) => api.tasks.vetApprove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/appointments", day], exact: true });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/dashboard", meUserId ?? ""], exact: true });
      toast.success("תרופה אושרה — טכנאי קיבל הודעה");
    },
    onError: (error: Error) => {
      toast.error(toErrorMessage(error));
    },
  });

  const canApproveAsMedVet = isVetOrAdmin(role, effectiveRole);

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
      toast.info("משימה עודכנה אוטומטית על ידי כלל אוטומציה");
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/dashboard", meUserId ?? ""], exact: true });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/recommendations"], exact: true });
      return;
    }
    if (event.type === "NOTIFICATION_SENT") return;
  }, [day, meUserId, queryClient]);

  useRealtime(handleRealtimeEvent);

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
    if (formTaskType === "medication") {
      throw new Error(
        "[VetTrack] Medication must be created via MedicationCalculator. " +
        "Task dialog creation is blocked for medication task type.",
      );
    }

    if (!formVetId.trim()) {
      toast.error("בחר טכנאי לפני יצירת משימה.");
      return;
    }
    if (!formAnimalId.trim()) {
      toast.error("נדרש לבחור מכשיר / נכס.");
      return;
    }

    const start = new Date(formStartLocal);
    const end = new Date(formEndLocal);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      toast.error("הזן שעות התחלה וסיום תקינות.");
      return;
    }
    if (end.getTime() <= start.getTime()) {
      toast.error("שעת הסיום חייבת להיות אחרי שעת ההתחלה.");
      return;
    }

    if (isMedicationForm) {
      toast.error("משימות תרופות חייבות להיווצר דרך מחשבון התרופות.");
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
    { href: "/appointments", icon: CalendarDays, label: "Tasks" },
  ];

  const isDesktop = typeof window !== "undefined" && window.innerWidth >= 1024;
  const pageContent = (
    <>
      <div dir="rtl" className="flex flex-col gap-4 pb-24 text-right">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CalendarDays className="w-6 h-6" />
            Tasks
          </h1>
          <p className="text-sm text-muted-foreground">
            Your tasks for today, prioritized by urgency and schedule.
          </p>
        </div>

        <Card className="bg-card border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">מה לעשות עכשיו?</CardTitle>
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
                message="הכל מעודכן"
                subMessage="אין משימות ממתינות כרגע."
                action={canCreateTask ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 px-3 text-xs"
                    onClick={() => openQuickBooking(new Date())}
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" />
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
                      {formatScheduledLabel(nbt) || formatPrescribedByLabel(nbt) ? (
                        <div className="text-xs text-muted-foreground">
                          {compactMeta(formatScheduledLabel(nbt), formatPrescribedByLabel(nbt))}
                        </div>
                      ) : null}
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${PRIORITY_COLORS[nbt.priority ?? "normal"]}`}
                    >
                      {nbt.priority ?? "normal"}
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
                    {isDelayedMedicationTask(nbt) ? (
                      <Badge variant="outline" className="text-[10px] bg-red-100 border-red-300 text-red-900">
                        {t.appointmentsPage.delayed}
                      </Badge>
                    ) : null}
                    {canApproveAsMedVet && isMedicationNeedingApproval(nbt) ? (
                      <Button
                        size="sm"
                        variant="default"
                        className="h-8 px-3 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                        disabled={vetApproveMutation.isPending}
                        onClick={() => vetApproveMutation.mutate(nbt.id)}
                      >
                        {t.appointmentsPage.administerMedication}
                      </Button>
                    ) : null}
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
                      {formatScheduledLabel(overdueItem) || formatPrescribedByLabel(overdueItem) ? (
                        <div className="text-xs text-muted-foreground mt-1">
                          {compactMeta(formatScheduledLabel(overdueItem), formatPrescribedByLabel(overdueItem))}
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
                      {formatScheduledLabel(urgentItem) || formatPrescribedByLabel(urgentItem) ? (
                        <div className="text-xs text-muted-foreground mt-1">
                          {compactMeta(formatScheduledLabel(urgentItem), formatPrescribedByLabel(urgentItem))}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {(dashboardQuery.data?.overdue.length ?? 0) === 0 && (recommendationsQuery.data?.urgentTasks.length ?? 0) === 0 ? (
                  <EmptyState
                    icon={CheckCircle2}
                    message="אין דחוף כרגע"
                    subMessage="הכל במסלול תקין."
                  action={(
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-3 text-xs"
                      onClick={() => myTasksRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                    >
                      View my tasks
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
                  message="You're all caught up"
                  subMessage="No tasks are due today."
                  action={canCreateTask ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-3 text-xs"
                      onClick={() => openQuickBooking(new Date())}
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" />
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
                          {isDelayedMedicationTask(todayTask) ? (
                            <Badge variant="outline" className="text-[10px] bg-red-100 border-red-300 text-red-900">
                              {t.appointmentsPage.delayed}
                            </Badge>
                          ) : null}
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${PRIORITY_COLORS[todayTask.priority ?? "normal"]}`}
                          >
                            {todayTask.priority ?? "normal"}
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
                      {formatScheduledLabel(todayTask) || formatPrescribedByLabel(todayTask) ? (
                        <div className="text-xs text-muted-foreground">
                          {compactMeta(formatScheduledLabel(todayTask), formatPrescribedByLabel(todayTask))}
                        </div>
                      ) : null}
                      <div className="flex flex-wrap gap-2 mt-1">
                        {canApproveAsMedVet && isMedicationNeedingApproval(todayTask) ? (
                          <Button
                            size="sm"
                            variant="default"
                            className="h-8 px-3 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                            disabled={vetApproveMutation.isPending}
                            onClick={() => vetApproveMutation.mutate(todayTask.id)}
                          >
                            {t.appointmentsPage.administerMedication}
                          </Button>
                        ) : null}
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
                My tasks
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
                  message="אין משימות מוקצות"
                  subMessage="בחר משימה מהתור כשאתה מוכן."
                  action={(
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-3 text-xs"
                      onClick={() => urgentRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                    >
                      Review urgent
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
                          {isDelayedMedicationTask(myTask) ? (
                            <Badge variant="outline" className="text-[10px] bg-red-100 border-red-300 text-red-900">
                              {t.appointmentsPage.delayed}
                            </Badge>
                          ) : null}
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${PRIORITY_COLORS[myTask.priority ?? "normal"]}`}
                          >
                            {myTask.priority ?? "normal"}
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
                      {formatScheduledLabel(myTask) || formatPrescribedByLabel(myTask) ? (
                        <div className="text-xs text-muted-foreground">
                          {compactMeta(formatScheduledLabel(myTask), formatPrescribedByLabel(myTask))}
                        </div>
                      ) : null}
                      <div className="flex flex-wrap gap-2 mt-1">
                        {canApproveAsMedVet && isMedicationNeedingApproval(myTask) ? (
                          <Button
                            size="sm"
                            variant="default"
                            className="h-8 px-3 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                            disabled={vetApproveMutation.isPending}
                            onClick={() => vetApproveMutation.mutate(myTask.id)}
                          >
                            {t.appointmentsPage.administerMedication}
                          </Button>
                        ) : null}
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
            <CardTitle className="text-sm font-semibold">Suggestions</CardTitle>
          </CardHeader>
          <CardContent>
            {recommendationsQuery.isLoading && !recommendationsQuery.data ? (
              <LoadingSection rows={2} />
            ) : (recommendationsQuery.data?.suggestions.length ?? 0) === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                message="אין הצעות"
                subMessage="הכל נראה תקין כרגע."
                action={canCreateTask ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 px-3 text-xs"
                    onClick={() => openQuickBooking(new Date())}
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" />
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
                          ? `${dashboardQuery.data?.counts.overdue ?? 0} באיחור — סקור עכשיו`
                          : suggestion.type === "START_NOW"
                            ? "המשימה הבאה מוכנה — התחל עכשיו"
                            : suggestion.type === "OVERLOADED"
                              ? "עומס גבוה — סקור משימות דחופות"
                              : "התור פתוח — בחר משימה"}
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
                            ? "צפה בתור"
                              : "סקור דחופות"}
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
                Task Controls
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
            <div>
              <label htmlFor={`${bookingFormId}-filter-day`} className="text-xs text-muted-foreground block text-right">Day</label>
              <Input id={`${bookingFormId}-filter-day`} dir="ltr" className="text-left" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
            </div>
            <div>
              <label htmlFor={`${bookingFormId}-filter-tech`} className="text-xs text-muted-foreground block text-right">Technician</label>
              <select
                id={`${bookingFormId}-filter-tech`}
                dir="ltr"
                value={selectedVetId}
                onChange={(e) => setSelectedVetId(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-left"
              >
                <option value="">All technicians</option>
                {(metaQuery.data?.vets ?? []).map((vet) => (
                  <option key={vet.id} value={vet.id}>
                    {vet.displayName || vet.name || "Unknown user"}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block text-right">Hours</label>
              <div className="h-10 px-3 rounded-md border flex items-center text-sm">
                {DAY_START_HOUR}:00 - {DAY_END_HOUR}:00
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block text-right">Interval</label>
              <div className="h-10 px-3 rounded-md border flex items-center text-sm">{SLOT_MINUTES} min</div>
            </div>
            {canCreateTask && (
              <div>
                <Button className="w-full" onClick={() => openQuickBooking(new Date())}>
                  <Plus className="w-4 h-4 mr-1" />
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
              Day View
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {selectedVetMeta ? (
              <div className="text-xs text-muted-foreground">
                Shift windows for {selectedVetMeta.displayName || selectedVetMeta.name}:{" "}
                {selectedVetMeta.shifts.length > 0
                  ? selectedVetMeta.shifts.map((s) => `${s.startTime.slice(0, 5)}-${s.endTime.slice(0, 5)}`).join(", ")
                  : "No shift imported for this day"}
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
                        <div key={hour} className="absolute left-0 right-0 border-t border-dashed border-border/70" style={{ top: y }}>
                          <span className="absolute -top-2 left-2 text-[10px] text-muted-foreground bg-background px-1">
                            {String(hour).padStart(2, "0")}:00
                          </span>
                        </div>
                      );
                    })}

                    {canCreateTask && slotAvailability.map(({ slot, available }) => {
                      const top = minutesSinceDayStart(day, slot) * PIXELS_PER_MINUTE;
                      return (
                        <button
                          key={slot.toISOString()}
                          type="button"
                          disabled={!available}
                          onClick={() => openQuickBooking(slot)}
                          className={`absolute left-0 right-0 text-left px-3 border-t ${
                            available
                              ? "hover:bg-emerald-50/60 focus:bg-emerald-50/80"
                              : "bg-muted/40 cursor-not-allowed"
                          }`}
                          style={{ top, height: SLOT_MINUTES * PIXELS_PER_MINUTE }}
                          aria-label={`Schedule task ${formatTimeHHMM(slot)}`}
                        />
                      );
                    })}

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
                        className={`absolute left-16 sm:left-24 right-3 rounded-lg border shadow-sm p-2 ${STATUS_COLORS[appointment.status]}`}
                        style={{ top: top + 1, height }}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-xs font-semibold break-words">
                            <span className="min-w-0">{formatDevice(appointment.animalId)}</span>
                            <PatientChartLink animalId={appointment.animalId} />
                          </div>
                          <div className="flex flex-wrap justify-end gap-1 shrink-0">
                            {isDelayedMedicationTask(appointment) ? (
                              <Badge variant="outline" className="text-[10px] bg-red-100 border-red-300 text-red-900">
                                {t.appointmentsPage.delayed}
                              </Badge>
                            ) : null}
                            <Badge variant="secondary" className="text-[10px]">
                              {STATUS_LABEL[appointment.status]}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${PRIORITY_BADGE[appointment.priority ?? "normal"] ?? PRIORITY_BADGE.normal}`}
                            >
                              {appointment.priority ?? "normal"}
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
                        {formatScheduledLabel(appointment) || formatPrescribedByLabel(appointment) ? (
                          <div className="text-[11px] mt-1 truncate text-muted-foreground">
                            {compactMeta(formatScheduledLabel(appointment), formatPrescribedByLabel(appointment))}
                          </div>
                        ) : null}
                        {appointment.conflictOverride ? (
                          <div className="text-[10px] mt-1 font-medium">Override applied</div>
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
                              {STATUS_LABEL[nextStatus]}
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
                                <Plus className="w-3.5 h-3.5 mr-1" />
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
        <DialogContent dir="rtl" className="text-right max-h-[85dvh] flex flex-col overflow-hidden p-0">
          <DialogHeader className="shrink-0 px-6 pt-6">
            <div className="flex items-start gap-2">
              {isMedicationForm ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0 h-9 w-9"
                aria-label="חזרה לבחירת סוג משימה"
                  onClick={() => setFormTaskType("maintenance")}
                >
                  <ChevronRight className="h-5 w-5" />
                </Button>
              ) : null}
              <div className="min-w-0 flex-1 space-y-1 text-right">
                <DialogTitle>{isMedicationForm ? "Give Medication" : "New Task"}</DialogTitle>
                <DialogDescription>
                  {isMedicationForm ? (
                    <>Confirm weight, dose, and volume in the calculator, then administer.</>
                  ) : (
                    <>
                      Assign a device and technician.{" "}
                      <span dir="ltr" className="inline-block text-left">
                        Tap a slot to prefill the time.
                      </span>
                    </>
                  )}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
          {formTaskType === "medication" ? (
  <div className="flex flex-col gap-4">
    <div>
      <label className="text-xs text-muted-foreground block text-right">Device / Asset (required)</label>
      <Input
        dir="ltr"
        className="text-left"
        value={formAnimalId}
        onChange={(e) => setFormAnimalId(e.target.value)}
        placeholder="e.g. Ventilator, Autoclave"
      />
    </div>

    {!formAnimalId.trim() ? (
      <p
        role="alert"
        className="text-sm text-destructive text-center rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2"
      >
        Enter Device / Asset before giving medication.
      </p>
    ) : (
      <MedicationCalculator
        animalId={formAnimalId.trim()}
        onCancel={() => setFormTaskType("maintenance")}
        onComplete={() => {
          toast.success("תרופה ניתנה");
          queryClient.invalidateQueries({ queryKey: ["/api/appointments", day], exact: true });
          queryClient.invalidateQueries({ queryKey: ["/api/tasks/dashboard", meUserId ?? ""], exact: true });
          queryClient.invalidateQueries({ queryKey: ["/api/tasks/recommendations"], exact: true });

          setBookingOpen(false);
          setFormNotes("");
          setFormAnimalId("");
          setFormOwnerId("");
          setFormTaskType("maintenance");
        }}
      />
    )}
  </div>
) : (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
    <div>
      <label htmlFor={`${bookingFormId}-vet`} className="text-xs text-muted-foreground block text-right">
        Technician <span className="text-destructive" aria-hidden>*</span>
      </label>
      <select
        id={`${bookingFormId}-vet`}
        dir="ltr"
        value={formVetId}
        onChange={(e) => setFormVetId(e.target.value)}
        required
        aria-required="true"
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-left"
      >
        <option value="">Select technician</option>
        {(metaQuery.data?.vets ?? []).map((vet) => (
          <option key={vet.id} value={vet.id}>
            {vet.displayName || vet.name || "Unknown user"}
          </option>
        ))}
      </select>
    </div>

    <div>
      <label htmlFor={`${bookingFormId}-asset`} className="text-xs text-muted-foreground block text-right">
        Device / Asset <span className="text-destructive" aria-hidden>*</span>
      </label>
      <Input
        id={`${bookingFormId}-asset`}
        dir="ltr"
        className="text-left"
        value={formAnimalId}
        onChange={(e) => setFormAnimalId(e.target.value)}
        placeholder="e.g. Ventilator, Autoclave"
        required
        aria-required="true"
      />
    </div>

    <div>
      <label htmlFor={`${bookingFormId}-location`} className="text-xs text-muted-foreground block text-right">
        Location / Department
      </label>
      <Input
        id={`${bookingFormId}-location`}
        dir="ltr"
        className="text-left"
        value={formOwnerId}
        onChange={(e) => setFormOwnerId(e.target.value)}
        placeholder="ICU / ER / Ward"
      />
    </div>

    <div>
      <label htmlFor={`${bookingFormId}-tasktype`} className="text-xs text-muted-foreground block text-right">Task type</label>
      <select
        id={`${bookingFormId}-tasktype`}
        dir="ltr"
        value={formTaskType ?? "maintenance"}
        onChange={(e) => {
          const nextType = (e.target.value || "maintenance") as Appointment["taskType"];
          setFormTaskType(nextType);
        }}
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-left"
      >
        {ALLOWED_BOOKING_TASK_TYPES.map((taskType) => (
          <option key={taskType.value} value={taskType.value}>
            {taskType.label}
          </option>
        ))}
      </select>
    </div>

    <div>
      <label htmlFor={`${bookingFormId}-duration`} className="text-xs text-muted-foreground block text-right">Duration preset</label>
      <select
        id={`${bookingFormId}-duration`}
        dir="ltr"
        value={String(selectedDuration)}
        onChange={(e) => {
          setSelectedDuration(Number.parseInt(e.target.value, 10));
          setManualEndOverride(false);
        }}
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-left"
      >
        {DURATION_PRESETS.map((preset) => (
          <option key={preset.key} value={preset.minutes}>
            {preset.label}
          </option>
        ))}
      </select>
    </div>

    <div>
      <label htmlFor={`${bookingFormId}-start`} className="text-xs text-muted-foreground block text-right">
        Scheduled time <span className="text-muted-foreground/70">({USER_TIMEZONE})</span>
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
      <label htmlFor={`${bookingFormId}-end`} className="text-xs text-muted-foreground block text-right">Expected end</label>
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
      <label htmlFor={`${bookingFormId}-notes`} className="text-xs text-muted-foreground block text-right">Notes</label>
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
)}
          </div>
          <DialogFooter className="shrink-0 border-t bg-background px-6 py-4">
            <Button variant="outline" onClick={() => setBookingOpen(false)}>
              Cancel
            </Button>
            {!isMedicationForm ? (
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
                {createMutation.isPending ? "שומר..." : "צור משימה"}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={conflictOpen} onOpenChange={setConflictOpen}>
        <DialogContent dir="rtl" className="text-right max-h-[85dvh] flex flex-col overflow-hidden p-0">
          <DialogHeader className="shrink-0 px-6 pt-6">
            <DialogTitle>Scheduling conflict</DialogTitle>
            <DialogDescription>
              This time overlaps an existing task. Provide a reason to override.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
              <label className="text-xs text-muted-foreground block text-right">Reason for override</label>
            <Textarea dir="ltr" className="text-left" value={conflictReason} onChange={(e) => setConflictReason(e.target.value)} rows={3} />
          </div>
          <DialogFooter className="shrink-0 border-t bg-background px-6 py-4">
            <Button variant="outline" onClick={() => setConflictOpen(false)}>
              Keep original
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
              Confirm Override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
  if (isDesktop) {
    return <PageShell sidebarItems={TASKS_SIDEBAR}>{pageContent}</PageShell>;
  }
  return <Layout title="Tasks">{pageContent}</Layout>;
}
