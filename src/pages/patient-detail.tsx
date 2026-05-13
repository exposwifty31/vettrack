import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link, Redirect, useLocation, useParams } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  ClipboardList,
  Clock,
  LayoutGrid,
  MapPin,
  Package,
  Pencil,
  Pill,
  Radar,
  Receipt,
  Sparkles,
  Stethoscope,
  Syringe,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { t, getDirection } from "@/lib/i18n";
import { api } from "@/lib/api";
import { Layout } from "@/components/layout";
import { PageShell } from "@/components/layout/PageShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorCard } from "@/components/ui/error-card";
import { useAuth } from "@/hooks/use-auth";
import { useSettings } from "@/hooks/use-settings";
import { cn, computeAlerts, formatRelativeTime } from "@/lib/utils";
import { statusToBadgeVariant } from "@/lib/design-tokens";
import type {
  ActivityFeedItem,
  Appointment,
  BillingLedgerEntry,
  Equipment,
  Hospitalization,
  HospitalizationStatus,
  UpdatePatientRequest,
} from "@/types";
type MedicationExecutionTask = import("@/types").MedicationExecutionTask;

const ROLE_LEVEL: Record<string, number> = {
  admin: 40,
  vet: 30,
  senior_technician: 25,
  lead_technician: 22,
  vet_tech: 20,
  technician: 20,
  student: 10,
};

function roleLevel(role: string | null | undefined): number {
  return ROLE_LEVEL[String(role ?? "").trim().toLowerCase()] ?? 0;
}

function metaString(meta: Record<string, unknown> | null | undefined, keys: string[]): string | null {
  if (!meta) return null;
  for (const k of keys) {
    const v = meta[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const BILLING_STATUS_CLASS: Record<BillingLedgerEntry["status"], string> = {
  pending: "bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800",
  synced: "bg-emerald-100 text-emerald-900 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800",
  voided: "bg-muted text-muted-foreground border-border line-through",
};

const APPOINTMENT_STATUS_LABEL: Record<Appointment["status"], string> = {
  pending: "ממתין",
  assigned: "הוקצה",
  scheduled: "מתוזמן",
  arrived: "הגיע",
  in_progress: "בביצוע",
  completed: "הושלם",
  cancelled: "בוטל",
  no_show: "לא הופיע",
};

function medDrugLabel(task: MedicationExecutionTask): string {
  if (!task.metadata || typeof task.metadata !== "object" || Array.isArray(task.metadata)) {
    return typeof task.notes === "string" && task.notes.trim() ? task.notes.trim() : "—";
  }
  const m = task.metadata as Record<string, unknown>;
  const name = metaString(m, ["drugName", "medicationName"]);
  if (name) return name;
  return typeof task.notes === "string" && task.notes.trim() ? task.notes.trim() : "—";
}

function SectionTitle({
  icon: Icon,
  title,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  className?: string;
}) {
  return (
    <div className={cn("mb-3 flex items-center gap-2", className)}>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-muted/40">
        <Icon className="h-4 w-4 text-primary" />
      </span>
      <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
    </div>
  );
}

const EDITABLE_STATUSES: HospitalizationStatus[] = ["admitted", "observation", "critical", "recovering"];
const SPECIES_OPTIONS = ["כלב", "חתול", "ציפור", "ארנב", "שאר"];
const SEX_OPTIONS = ["זכר", "נקבה", "לא ידוע"];

function normalize(v: string | null | undefined): string {
  return (v ?? "").trim();
}

function EditPatientSheet({
  open,
  hospitalization,
  onClose,
}: {
  open: boolean;
  hospitalization: Hospitalization;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const p = t.patientDetail;

  const initial = useMemo(
    () => ({
      animalName: hospitalization.animal.name ?? "",
      species: hospitalization.animal.species ?? "",
      breed: hospitalization.animal.breed ?? "",
      sex: hospitalization.animal.sex ?? "",
      ward: hospitalization.ward ?? "",
      bay: hospitalization.bay ?? "",
      admissionReason: hospitalization.admissionReason ?? "",
      status: hospitalization.status,
    }),
    [hospitalization],
  );

  const [form, setForm] = useState(initial);

  // Re-seed form whenever the sheet opens (so cancel-then-reopen resets cleanly).
  useEffect(() => {
    if (open) setForm(initial);
  }, [open, initial]);

  const updateMut = useMutation({
    mutationFn: (patch: UpdatePatientRequest) => api.patients.update(hospitalization.id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/patients"] });
      toast.success(p.editSavedToast);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message || p.editFailedToast),
  });

  function buildPatch(): UpdatePatientRequest {
    const patch: UpdatePatientRequest = {};
    if (normalize(form.animalName) && normalize(form.animalName) !== normalize(initial.animalName)) {
      patch.animalName = normalize(form.animalName);
    }
    if (normalize(form.species) !== normalize(initial.species)) {
      patch.species = normalize(form.species) || null;
    }
    if (normalize(form.breed) !== normalize(initial.breed)) {
      patch.breed = normalize(form.breed) || null;
    }
    if (normalize(form.sex) !== normalize(initial.sex)) {
      patch.sex = normalize(form.sex) || null;
    }
    if (normalize(form.ward) !== normalize(initial.ward)) {
      patch.ward = normalize(form.ward) || null;
    }
    if (normalize(form.bay) !== normalize(initial.bay)) {
      patch.bay = normalize(form.bay) || null;
    }
    if (normalize(form.admissionReason) !== normalize(initial.admissionReason)) {
      patch.admissionReason = normalize(form.admissionReason) || null;
    }
    if (form.status !== initial.status && form.status !== "discharged" && form.status !== "deceased") {
      patch.status = form.status as Exclude<HospitalizationStatus, "discharged">;
    }
    return patch;
  }

  const pendingPatch = buildPatch();
  const hasChanges = Object.keys(pendingPatch).length > 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!hasChanges) return;
    updateMut.mutate(pendingPatch);
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && !updateMut.isPending && onClose()}>
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-2xl">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2 text-lg">
            <Pencil className="h-5 w-5 text-primary" />
            {p.editTitle}
          </SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pb-6">
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">{p.editFieldName}</Label>
            <Input
              value={form.animalName}
              onChange={(e) => setForm((f) => ({ ...f, animalName: e.target.value }))}
              data-testid="input-edit-patient-name"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{p.editFieldSpecies}</Label>
              <Select
                value={form.species || ""}
                onValueChange={(v) => setForm((f) => ({ ...f, species: v }))}
              >
                <SelectTrigger data-testid="select-edit-patient-species">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {SPECIES_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{p.editFieldBreed}</Label>
              <Input
                value={form.breed}
                onChange={(e) => setForm((f) => ({ ...f, breed: e.target.value }))}
                data-testid="input-edit-patient-breed"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{p.editFieldSex}</Label>
              <Select
                value={form.sex || ""}
                onValueChange={(v) => setForm((f) => ({ ...f, sex: v }))}
              >
                <SelectTrigger data-testid="select-edit-patient-sex">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {SEX_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{p.editFieldStatus}</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm((f) => ({ ...f, status: v as HospitalizationStatus }))}
              >
                <SelectTrigger data-testid="select-edit-patient-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EDITABLE_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{p[`hospStatus${s.charAt(0).toUpperCase()}${s.slice(1)}` as keyof typeof p] as string}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{p.editFieldWard}</Label>
              <Input
                value={form.ward}
                onChange={(e) => setForm((f) => ({ ...f, ward: e.target.value }))}
                data-testid="input-edit-patient-ward"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{p.editFieldBay}</Label>
              <Input
                value={form.bay}
                onChange={(e) => setForm((f) => ({ ...f, bay: e.target.value }))}
                data-testid="input-edit-patient-bay"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">{p.editFieldReason}</Label>
            <Textarea
              value={form.admissionReason}
              onChange={(e) => setForm((f) => ({ ...f, admissionReason: e.target.value }))}
              rows={2}
              className="resize-none"
              data-testid="input-edit-patient-reason"
            />
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={onClose}
              disabled={updateMut.isPending}
              data-testid="btn-edit-patient-cancel"
            >
              {p.editCancel}
            </Button>
            <Button
              type="submit"
              className="flex-1"
              disabled={updateMut.isPending || !hasChanges}
              data-testid="btn-edit-patient-save"
              title={!hasChanges ? p.editNoChanges : undefined}
            >
              {updateMut.isPending ? p.editSaving : p.editSave}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export default function PatientDetailPage() {
  const { id: animalId } = useParams<{ id: string }>();
  const p = t.patientDetail;
  const [, navigate] = useLocation();
  const { userId, effectiveRole, role } = useAuth();
  const { settings } = useSettings();
  const dir = getDirection(settings.locale);
  const resolvedRole = String(effectiveRole ?? role ?? "").trim().toLowerCase();
  const canTasks = roleLevel(resolvedRole) >= ROLE_LEVEL.technician;
  const canBilling = roleLevel(resolvedRole) >= ROLE_LEVEL.vet;
  const canEdit = roleLevel(resolvedRole) >= ROLE_LEVEL.technician;
  const [editOpen, setEditOpen] = useState(false);

  // Fetch active hospitalization for this animal (if any)
  const hospQ = useQuery({
    queryKey: ["/api/patients", "by-animal", animalId],
    queryFn: async () => {
      const r = await api.patients.list({ q: "" });
      return r.patients.find((p) => p.animalId === animalId) ?? null;
    },
    enabled: Boolean(userId && animalId),
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const equipmentQ = useQuery({
    queryKey: ["/api/equipment"],
    queryFn: api.equipment.list,
    enabled: Boolean(userId),
    staleTime: 20_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const billingQ = useQuery({
    queryKey: ["/api/billing", "patient", animalId],
    queryFn: () => api.billing.list({ animalId: animalId!, limit: 25 }),
    enabled: Boolean(userId && animalId && canBilling),
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const dashboardQ = useQuery({
    queryKey: ["/api/tasks/dashboard", userId ?? "", "patient"],
    queryFn: () => api.tasks.dashboard(),
    enabled: Boolean(userId && animalId && canTasks),
    staleTime: 20_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const medActiveQ = useQuery({
    queryKey: ["/api/tasks/medication-active", userId ?? "", "patient"],
    queryFn: () => api.tasks.medicationActive(),
    enabled: Boolean(userId && animalId && canTasks),
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const activityQ = useQuery({
    queryKey: ["/api/activity", "patient", animalId],
    queryFn: () => api.activity.feed(),
    enabled: Boolean(userId && animalId),
    staleTime: 20_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const dischargeQ = useQuery({
    queryKey: ["/api/shift-handover/discharge", animalId],
    queryFn: () => api.shiftHandover.getDischargeItems(animalId!),
    enabled: Boolean(userId && animalId && canTasks),
    staleTime: 20_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const derived = useMemo(() => {
    if (!animalId) {
      return {
        patientName: p.unknownName,
        species: null as string | null,
        roomName: null as string | null,
        roomId: null as string | null,
        linkedEquipment: [] as Equipment[],
        patientEquipmentIds: new Set<string>(),
        careTasks: [] as Appointment[],
        medTasks: [] as MedicationExecutionTask[],
        patientAlerts: [] as ReturnType<typeof computeAlerts>,
        timeline: [] as ActivityFeedItem[],
        billing: [] as BillingLedgerEntry[],
        dischargeItems: [] as { sessionId: string; equipmentId: string; equipmentName: string; startedAt: string }[],
        statusKind: "stable" as "stable" | "attention" | "in_progress" | "billing",
      };
    }

    const equipment = equipmentQ.data ?? [];
    const linkedEquipment = equipment.filter((e) => e.linkedAnimalId === animalId);
    const patientEquipmentIds = new Set(linkedEquipment.map((e) => e.id));

    const dischargeItems = dischargeQ.data?.items ?? [];
    for (const row of dischargeItems) {
      if (row.equipmentId) patientEquipmentIds.add(row.equipmentId);
    }

    // Prefer the hospitalization record (authoritative animal data + ward/bay)
    // over equipment-link metadata, so a freshly admitted patient with no
    // equipment linked still shows the values entered on admission.
    const hosp = hospQ.data;

    let patientName = p.unknownName;
    if (hosp?.animal?.name?.trim()) {
      patientName = hosp.animal.name.trim();
    } else {
      const fromEq = linkedEquipment.find((e) => e.linkedAnimalName?.trim());
      if (fromEq?.linkedAnimalName?.trim()) patientName = fromEq.linkedAnimalName.trim();
    }

    let species: string | null = null;
    let roomName: string | null = null;
    let roomId: string | null = null;

    if (hosp?.animal?.species?.trim()) {
      species = [hosp.animal.species, hosp.animal.breed].filter((s) => s && s.trim()).join(" · ").trim() || null;
    }

    const wardBay = hosp ? [hosp.ward, hosp.bay].filter((s) => s && s.trim()).join(" · ").trim() : "";
    if (wardBay) roomName = wardBay;

    const firstRoomed = linkedEquipment.find((e) => e.roomId && e.roomName);
    if (firstRoomed) {
      roomId = firstRoomed.roomId ?? null;
      if (!roomName) roomName = firstRoomed.roomName ?? null;
    }

    const dashboard = dashboardQ.data;
    const allAppointments: Appointment[] = dashboard
      ? [...dashboard.overdue, ...dashboard.today, ...dashboard.upcoming, ...dashboard.myTasks]
      : [];
    const careTasks = allAppointments
      .filter((a) => a.animalId === animalId && a.status !== "completed" && a.status !== "cancelled" && a.status !== "no_show")
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    if (!species) {
      for (const task of careTasks) {
        if (!task.metadata || typeof task.metadata !== "object") continue;
        const m = task.metadata as Record<string, unknown>;
        const sp = metaString(m, ["species", "animalSpecies", "patientSpecies"]);
        if (sp) {
          species = sp;
          break;
        }
      }
    }

    const medTasks = (medActiveQ.data ?? []).filter((task) => task.animalId === animalId);

    const hasOverdue = careTasks.some((a) => a.isOverdue);
    const hasInProgress = careTasks.some((a) => a.status === "in_progress") || medTasks.some((m) => m.status === "in_progress");
    const hasOpenUsage = dischargeItems.length > 0;

    let statusKind: "stable" | "attention" | "in_progress" | "billing" = "stable";
    if (hasInProgress) statusKind = "in_progress";
    else if (hasOverdue) statusKind = "attention";
    else if (hasOpenUsage) statusKind = "billing";

    const patientAlerts = computeAlerts(equipment).filter((a) => patientEquipmentIds.has(a.equipmentId));

    const activity = activityQ.data?.items ?? [];
    const timeline = activity
      .filter((item) => item.equipmentId && patientEquipmentIds.has(item.equipmentId))
      .slice(0, 14);

    const billing = (billingQ.data ?? []).slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return {
      patientName,
      species,
      roomName,
      roomId,
      linkedEquipment,
      patientEquipmentIds,
      careTasks,
      medTasks,
      patientAlerts,
      timeline,
      billing,
      dischargeItems,
      statusKind,
    };
  }, [
    animalId,
    hospQ.data,
    equipmentQ.data,
    dashboardQ.data,
    medActiveQ.data,
    activityQ.data,
    billingQ.data,
    dischargeQ.data,
    p.unknownName,
  ]);

  if (!animalId?.trim()) {
    return <Redirect to="/" />;
  }

  const loadingCore = equipmentQ.isLoading || hospQ.isLoading;
  const loadFailed = equipmentQ.isError;

  const statusBadge =
    derived.statusKind === "in_progress"
      ? { label: p.statusInProgress, className: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200" }
      : derived.statusKind === "attention"
        ? { label: p.statusAttention, className: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" }
        : derived.statusKind === "billing"
          ? { label: p.statusOpenBilling, className: "border-violet-300 bg-violet-50 text-violet-900 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200" }
          : { label: p.statusStable, className: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200" };

  const isDesktop = typeof window !== "undefined" && window.innerWidth >= 1024;
  const pageContent = (
    <>
      <Helmet>
        <title>{`${derived.patientName} — ${p.pageTitle} — VetTrack`}</title>
        <meta name="description" content="Patient operating center — equipment, billing, tasks, and activity in one place." />
      </Helmet>

      <div className="motion-safe:animate-page-enter pb-24">
        <div className="flex w-full flex-col gap-5 pt-2">
          <header className="flex flex-wrap items-center gap-2 sm:gap-3">
            <Button variant="ghost" size="sm" className="h-9 min-h-[40px] gap-1.5 px-2 text-muted-foreground hover:text-foreground" asChild>
              <Link href="/patients">
                <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
                {p.back}
              </Link>
            </Button>
            <div className="ms-auto flex min-w-0 max-w-full items-center gap-2 rounded-full border border-border/70 bg-muted/30 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="truncate">{p.operatingCenter}</span>
            </div>
          </header>

          {loadFailed ? (
            <ErrorCard message={p.loadError} onRetry={() => equipmentQ.refetch()} />
          ) : null}

          <section
            className="relative overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-card via-card to-muted/25 p-5 shadow-sm sm:p-6"
            style={{ direction: dir }}
          >
            <div className="pointer-events-none absolute -end-16 -top-20 h-48 w-48 rounded-full bg-primary/[0.07] blur-2xl" />
            <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="flex min-w-0 flex-1 gap-3 sm:gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-border/60 bg-background/80 shadow-inner">
                  <UserRound className="h-7 w-7 text-primary" />
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  {loadingCore ? (
                    <div className="space-y-2">
                      <Skeleton className="h-8 w-48 max-w-full" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                  ) : (
                    <>
                      <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{derived.patientName}</h1>
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground/80">{p.recordId}</span>
                        <span dir="ltr" className="ms-1.5 inline-block rounded-md bg-muted/80 px-1.5 py-0.5 font-mono text-[11px]">
                          {animalId}
                        </span>
                      </p>
                    </>
                  )}
                </div>
              </div>
              <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:items-center sm:shrink-0">
                <Badge
                  variant="outline"
                  className={cn(
                    "justify-center border px-3 py-1.5 text-xs font-semibold sm:justify-start",
                    statusBadge.className,
                  )}
                >
                  {statusBadge.label}
                </Badge>
                {canEdit && hospQ.data ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 gap-1.5"
                    onClick={() => setEditOpen(true)}
                    data-testid="btn-open-edit-patient"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    {p.editButton}
                  </Button>
                ) : null}
              </div>
            </div>

            <dl className="relative mt-5 grid grid-cols-1 gap-3 border-t border-border/50 pt-5 sm:grid-cols-3">
              <div className="rounded-2xl border border-border/50 bg-background/60 px-3 py-2.5">
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{p.summarySpecies}</dt>
                <dd className="mt-1 text-sm font-medium text-foreground">{derived.species ?? p.speciesUnknown}</dd>
              </div>
              <div className="rounded-2xl border border-border/50 bg-background/60 px-3 py-2.5">
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{p.summaryRoom}</dt>
                <dd className="mt-1 flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">{derived.roomName ?? p.roomUnknown}</span>
                </dd>
              </div>
              <div className="rounded-2xl border border-border/50 bg-background/60 px-3 py-2.5">
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{p.summaryStatus}</dt>
                <dd className="mt-1 text-sm font-medium text-foreground">{statusBadge.label}</dd>
              </div>
            </dl>
          </section>

          {/* Hospitalization banner — shown when this animal has an active admission */}
          {hospQ.data ? (() => {
            const hosp = hospQ.data;
            const STATUS_STYLES: Record<string, string> = {
              critical:    "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30",
              admitted:    "border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/30",
              observation: "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30",
              recovering:  "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30",
            };
            const DOT_STYLES: Record<string, string> = {
              critical:    "bg-red-500",
              admitted:    "bg-sky-500",
              observation: "bg-amber-500",
              recovering:  "bg-emerald-500",
            };
            const STATUS_LABELS: Record<string, string> = {
              admitted:    t.patientDetail.hospStatusAdmitted,
              observation: t.patientDetail.hospStatusObservation,
              critical:    t.patientDetail.hospStatusCritical,
              recovering:  t.patientDetail.hospStatusRecovering,
              discharged:  t.patientDetail.hospStatusDischarged,
              deceased:    t.patientDetail.hospStatusDeceased,
            };
            const panelClass = STATUS_STYLES[hosp.status] ?? "border-border bg-muted/30";
            const dotClass = DOT_STYLES[hosp.status] ?? "bg-muted-foreground";
            const statusLabel = STATUS_LABELS[hosp.status] ?? hosp.status;
            return (
              <div className={cn("rounded-2xl border px-4 py-3 flex flex-wrap items-center gap-3", panelClass)} style={{ direction: dir }}>
                <span className="flex items-center gap-2 shrink-0">
                  <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", dotClass, hosp.status === "critical" && "animate-pulse")} />
                  <Stethoscope className="h-4 w-4 text-foreground/70" />
                  <span className="text-sm font-semibold text-foreground">{statusLabel}</span>
                </span>
                {hosp.status === "critical" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-900/60 border border-red-700/50 text-red-300 text-xs px-2 py-0.5 font-semibold">
                    <AlertTriangle className="h-3 w-3" />
                    סיכון CPR
                  </span>
                )}
                {(hosp.ward || hosp.bay) ? (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5 shrink-0" />
                    {[hosp.ward, hosp.bay].filter(Boolean).join(" · ")}
                  </span>
                ) : null}
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5 shrink-0" />
                  <span dir="ltr">{formatRelativeTime(hosp.admittedAt)}</span>
                </span>
                {hosp.admittingVetName ? (
                  <span className="text-xs text-muted-foreground ms-auto">
                    {hosp.admittingVetName}
                  </span>
                ) : null}
                <Link
                  href="/patients"
                  className="ms-auto text-xs font-medium text-primary underline-offset-2 hover:underline shrink-0"
                >
                  מטופלים פעילים ←
                </Link>
                {(resolvedRole === "vet" || resolvedRole === "admin" || resolvedRole === "technician" || resolvedRole === "senior_technician") && (
                  <button
                    type="button"
                    onClick={() => navigate(`/code-blue?patientId=${hosp.animalId}&hospitalizationId=${hosp.id}`)}
                    className="flex items-center gap-1 rounded border border-red-800/60 bg-red-950/50 text-red-400 hover:bg-red-900/50 px-3 py-1.5 text-xs font-semibold transition-colors shrink-0"
                  >
                    <AlertTriangle className="h-3.5 w-3.5" />
                    CODE BLUE
                  </button>
                )}
              </div>
            );
          })() : null}

          <section style={{ direction: dir }}>
            <SectionTitle icon={Package} title={p.sectionEquipment} />
            {loadingCore ? (
              <div className="space-y-2">
                <Skeleton className="h-24 w-full rounded-2xl" />
                <Skeleton className="h-24 w-full rounded-2xl" />
              </div>
            ) : derived.linkedEquipment.length === 0 && derived.dischargeItems.length === 0 ? (
              <EmptyState icon={Package} message={p.equipmentEmpty} subMessage={p.equipmentEmptySub} />
            ) : (
              <div className="space-y-4">
                {derived.linkedEquipment.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{p.equipmentLinked}</p>
                    <ul className="space-y-2">
                      {derived.linkedEquipment.map((eq) => (
                        <li key={eq.id}>
                          <Card className="border-border/60 shadow-sm overflow-hidden transition-shadow duration-200 hover:shadow-md motion-reduce:hover:shadow-sm">
                            <div className={cn("flex border-s-[5px]", eq.status === "ok" ? "border-s-emerald-500" : "border-s-amber-500")}>
                              <CardContent className="flex w-full items-center gap-3 p-3">
                                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                  <Link href={`/equipment/${eq.id}`} className="font-semibold text-foreground hover:text-primary truncate">
                                    {eq.name}
                                  </Link>
                                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                                    {eq.roomName ? <span>{eq.roomName}</span> : null}
                                    {eq.checkedOutById ? (
                                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                                        {p.equipmentInUse}
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                                <Badge variant={statusToBadgeVariant(eq.status)} className="shrink-0 capitalize">
                                  {eq.status.replace(/_/g, " ")}
                                </Badge>
                              </CardContent>
                            </div>
                          </Card>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {derived.dischargeItems.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{p.equipmentOpenUsage}</p>
                    <ul className="space-y-2">
                      {derived.dischargeItems.map((row) => (
                        <li key={row.sessionId}>
                          <Card className="border-violet-200/60 bg-violet-50/30 dark:border-violet-900/50 dark:bg-violet-950/20">
                            <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3">
                              <div className="min-w-0">
                                <Link href={`/equipment/${row.equipmentId}`} className="font-semibold hover:text-primary truncate block">
                                  {row.equipmentName}
                                </Link>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  <span dir="ltr">{formatRelativeTime(row.startedAt)}</span>
                                </p>
                              </div>
                              <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1 text-xs" asChild>
                                <Link href="/shift-handover">
                                  {p.actionHandover}
                                  <ArrowUpRight className="h-3 w-3 rtl:rotate-180" />
                                </Link>
                              </Button>
                            </CardContent>
                          </Card>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : !canTasks ? null : null}
              </div>
            )}
          </section>

          <section style={{ direction: dir }}>
            <SectionTitle icon={Receipt} title={p.sectionBilling} />
            {!canBilling ? (
              <p className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                {p.billingRestricted}
              </p>
            ) : billingQ.isError ? (
              <ErrorCard message={t.billingLedger.loadError} onRetry={() => billingQ.refetch()} />
            ) : billingQ.isLoading ? (
              <Skeleton className="h-32 w-full rounded-2xl" />
            ) : derived.billing.length === 0 ? (
              <EmptyState icon={Receipt} message={p.billingEmpty} subMessage={p.billingEmptySub} />
            ) : (
              <Card className="border-border/60 shadow-sm overflow-hidden">
                <CardContent className="divide-y divide-border/60 p-0">
                  {derived.billing.slice(0, 8).map((entry) => (
                    <div key={entry.id} className="flex items-start justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium capitalize">
                          {entry.itemType.toLowerCase()} · <span dir="ltr" className="font-mono text-xs">{entry.itemId}</span>
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          <span dir="ltr">{formatRelativeTime(entry.createdAt)}</span>
                          {" · "}
                          <span dir="ltr">×{entry.quantity}</span>
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span dir="ltr" className="text-sm font-semibold tabular-nums">
                          {formatMoney(entry.totalAmountCents)}
                        </span>
                        <Badge variant="outline" className={cn("text-[10px]", BILLING_STATUS_CLASS[entry.status])}>
                          {entry.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </section>

          <section style={{ direction: dir }}>
            <SectionTitle icon={ClipboardList} title={p.sectionCare} />
            {!canTasks ? (
              <p className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                {p.tasksRestricted}
              </p>
            ) : dashboardQ.isError || medActiveQ.isError ? (
              <ErrorCard message={p.loadError} onRetry={() => { dashboardQ.refetch(); medActiveQ.refetch(); }} />
            ) : dashboardQ.isLoading || medActiveQ.isLoading ? (
              <Skeleton className="h-40 w-full rounded-2xl" />
            ) : (
              <div className="space-y-4">
                {derived.careTasks.length === 0 && derived.medTasks.length === 0 ? (
                  <EmptyState icon={ClipboardList} message={p.tasksEmpty} subMessage={p.tasksEmptySub} />
                ) : (
                  <>
                    {derived.careTasks.length > 0 ? (
                      <Card className="border-border/60 shadow-sm">
                        <CardContent className="space-y-2 p-3">
                          {derived.careTasks.slice(0, 8).map((task) => (
                            <div
                              key={task.id}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/50 bg-muted/15 px-3 py-2"
                            >
                              <div className="min-w-0">
                                <p className="text-sm font-medium">
                                  {task.taskType ? `${task.taskType.replace(/_/g, " ")} · ` : ""}
                                  <span className="text-muted-foreground">{APPOINTMENT_STATUS_LABEL[task.status]}</span>
                                </p>
                                {task.notes ? <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{task.notes}</p> : null}
                              </div>
                              <Badge variant="outline" className="shrink-0 text-[10px] capitalize">
                                {task.priority ?? "normal"}
                              </Badge>
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    ) : null}

                    {derived.medTasks.length > 0 ? (
                      <div className="space-y-2">
                        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          <Syringe className="h-3.5 w-3.5" />
                          {t.medsPage.taskLabel}
                        </p>
                        <Card className="border-border/60 shadow-sm">
                          <CardContent className="space-y-2 p-3">
                            {derived.medTasks.map((task) => (
                              <div
                                key={task.id}
                                className="rounded-xl border border-border/50 bg-background/80 px-3 py-2"
                              >
                                <p className="text-sm font-semibold">{medDrugLabel(task)}</p>
                                <p className="text-xs text-muted-foreground mt-0.5 capitalize">
                                  {task.status.replace(/_/g, " ")}
                                  {task.animalWeightKg != null ? (
                                    <span dir="ltr" className="ms-2">
                                      · {task.animalWeightKg} kg
                                    </span>
                                  ) : null}
                                </p>
                              </div>
                            ))}
                          </CardContent>
                        </Card>
                      </div>
                    ) : null}
                  </>
                )}

                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{p.alertsTitle}</p>
                  {derived.patientAlerts.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border/60 bg-muted/10 px-4 py-6 text-center">
                      <p className="text-sm font-medium text-foreground">{p.alertsEmpty}</p>
                      <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">{p.alertsEmptySub}</p>
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {derived.patientAlerts.slice(0, 6).map((alert) => (
                        <li key={`${alert.equipmentId}-${alert.type}`}>
                          <Card className="border-destructive/25 bg-destructive/[0.04]">
                            <CardContent className="flex items-start gap-2 p-3">
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold">{alert.equipmentName}</p>
                                <p className="text-xs text-muted-foreground mt-0.5">{alert.detail}</p>
                              </div>
                              <Badge variant="destructive" className="shrink-0 text-[10px] capitalize">
                                {alert.type.replace(/_/g, " ")}
                              </Badge>
                            </CardContent>
                          </Card>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </section>

          <section style={{ direction: dir }}>
            <SectionTitle icon={Activity} title={p.sectionTimeline} />
            {activityQ.isError ? (
              <ErrorCard message={p.loadError} onRetry={() => activityQ.refetch()} />
            ) : activityQ.isLoading ? (
              <Skeleton className="h-36 w-full rounded-2xl" />
            ) : derived.timeline.length === 0 ? (
              <EmptyState icon={Activity} message={p.timelineEmpty} subMessage={p.timelineEmptySub} />
            ) : (
              <Card className="border-border/60 shadow-sm">
                <CardContent className="divide-y divide-border/60 p-0">
                  {derived.timeline.map((item) => (
                    <div key={item.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {item.type === "scan"
                            ? p.timelineScan
                            : item.type === "transfer"
                              ? p.timelineTransfer
                              : p.timelineCreated}
                          {": "}
                          <Link href={`/equipment/${item.equipmentId}`} className="hover:text-primary">
                            {item.equipmentName}
                          </Link>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {item.note ? <span className="line-clamp-2">{item.note}</span> : null}
                        </p>
                      </div>
                      <span dir="ltr" className="shrink-0 text-xs text-muted-foreground">
                        {formatRelativeTime(item.timestamp)}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </section>

          <section className="pb-4" style={{ direction: dir }}>
            <SectionTitle icon={LayoutGrid} title={p.sectionQuickActions} />
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [-webkit-overflow-scrolling:touch] snap-x snap-mandatory">
              <Button variant="outline" className="h-auto min-h-[72px] min-w-[112px] shrink-0 snap-start flex-col gap-1 border-border/70 py-3" asChild>
                <Link href="/appointments">
                  <ClipboardList className="h-5 w-5 text-primary" />
                  <span className="text-xs font-semibold">{p.actionTasks}</span>
                  <span className="text-[10px] text-muted-foreground font-normal">{p.actionTasksHint}</span>
                </Link>
              </Button>
              <Button variant="outline" className="h-auto min-h-[72px] min-w-[112px] shrink-0 snap-start flex-col gap-1 border-border/70 py-3" asChild>
                <Link href="/meds">
                  <Pill className="h-5 w-5 text-primary" />
                  <span className="text-xs font-semibold">{p.actionMeds}</span>
                  <span className="text-[10px] text-muted-foreground font-normal">{p.actionMedsHint}</span>
                </Link>
              </Button>
              <Button variant="outline" className="h-auto min-h-[72px] min-w-[112px] shrink-0 snap-start flex-col gap-1 border-border/70 py-3" asChild>
                <Link href="/billing">
                  <Receipt className="h-5 w-5 text-primary" />
                  <span className="text-xs font-semibold">{p.actionBilling}</span>
                  <span className="text-[10px] text-muted-foreground font-normal">{p.actionBillingHint}</span>
                </Link>
              </Button>
              {derived.roomId ? (
                <Button variant="outline" className="h-auto min-h-[72px] min-w-[112px] shrink-0 snap-start flex-col gap-1 border-border/70 py-3" asChild>
                  <Link href={`/rooms/${derived.roomId}`}>
                    <Radar className="h-5 w-5 text-primary" />
                    <span className="text-xs font-semibold">{p.actionRoom}</span>
                    <span className="text-[10px] text-muted-foreground font-normal">{p.actionRoomHint}</span>
                  </Link>
                </Button>
              ) : (
                <Button variant="outline" className="h-auto min-h-[72px] min-w-[112px] shrink-0 snap-start flex-col gap-1 border-border/70 py-3" asChild>
                  <Link href="/rooms">
                    <Radar className="h-5 w-5 text-primary" />
                    <span className="text-xs font-semibold">{p.actionRoom}</span>
                    <span className="text-[10px] text-muted-foreground font-normal">{p.actionRoomHint}</span>
                  </Link>
                </Button>
              )}
              <Button variant="outline" className="h-auto min-h-[72px] min-w-[112px] shrink-0 snap-start flex-col gap-1 border-border/70 py-3" asChild>
                <Link href="/shift-handover">
                  <Sparkles className="h-5 w-5 text-primary" />
                  <span className="text-xs font-semibold">{p.actionHandover}</span>
                  <span className="text-[10px] text-muted-foreground font-normal">{p.actionHandoverHint}</span>
                </Link>
              </Button>
            </div>
          </section>
        </div>
      </div>

      {hospQ.data ? (
        <EditPatientSheet
          open={editOpen}
          hospitalization={hospQ.data}
          onClose={() => setEditOpen(false)}
        />
      ) : null}
    </>
  );
  if (isDesktop) return <PageShell>{pageContent}</PageShell>;
  return <Layout>{pageContent}</Layout>;
}
