import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect } from "wouter";
import { t } from "@/lib/i18n";
import { FormularyAdminSheet } from "@/components/formulary-admin-sheet";
import { Beaker, FlaskConical, Loader2, Pill, Syringe } from "lucide-react";
import { toast } from "sonner";
import { Layout } from "@/components/layout";
import { PageShell } from "@/components/layout/PageShell";
import type { SidebarItem } from "@/components/layout/IconSidebar";
import { MedicationCalculator } from "@/components/MedicationCalculator";
import { VerificationCalculator } from "@/components/VerificationCalculator";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorCard } from "@/components/ui/error-card";
import { api } from "@/lib/api";
import { leaderPoll } from "@/lib/leader";
import { useRealtime } from "@/hooks/useRealtime";
import { useAuth } from "@/hooks/use-auth";
import { useDrugFormulary } from "@/hooks/useDrugFormulary";
import type { MedicationExecutionPayload, MedicationExecutionTask } from "@/types";

type MedicationMetadata = {
  acknowledgedBy?: string;
  doseMgPerKg?: number;
  defaultDoseMgPerKg?: number;
  concentrationMgPerMl?: number;
  doseUnit?: string;
  drugName?: string;
  medicationName?: string;
  desiredDoseMg?: number;
  vetApproved?: boolean;
  [key: string]: unknown;
};

function asMedicationMetadata(task: MedicationExecutionTask): MedicationMetadata {
  if (!task.metadata || typeof task.metadata !== "object" || Array.isArray(task.metadata)) return {};
  return task.metadata as MedicationMetadata;
}

function resolveDrugName(task: MedicationExecutionTask): string {
  const metadata = asMedicationMetadata(task);
  const fromMetadata = [metadata.drugName, metadata.medicationName]
    .find((value) => typeof value === "string" && value.trim().length > 0);
  if (fromMetadata) return String(fromMetadata).trim();
  if (typeof task.notes === "string" && task.notes.trim().length > 0) return task.notes.trim();
  return t.medsPage.unspecifiedDrug;
}

function statusLabel(status: MedicationExecutionTask["status"]): string {
  const m = t.medsPage;
  switch (status) {
    case "scheduled": return m.statusScheduled;
    case "assigned": return m.statusAssigned;
    case "arrived": return m.statusArrived;
    case "in_progress": return m.statusInProgress;
    case "pending":
    default: return m.statusPending;
  }
}

function canExecuteMedicationTask(role: string | null | undefined, effectiveRole: string | null | undefined): boolean {
  const r = String(effectiveRole ?? role ?? "").trim().toLowerCase();
  return r === "technician" || r === "lead_technician" || r === "vet_tech" || r === "senior_technician" || r === "admin";
}

function completeButtonState(args: {
  task: MedicationExecutionTask;
  meId?: string | null;
  meClerkId?: string | null;
  role?: string | null;
  effectiveRole?: string | null;
}): { disabled: boolean; tooltip: string } {
  const { task, meId, meClerkId, role, effectiveRole } = args;
  if (task.status !== "in_progress") {
    return { disabled: true, tooltip: t.medsPage.completeDisabledStatus };
  }
  const resolvedRole = (effectiveRole || role || "").toLowerCase();
  if (resolvedRole === "vet" || resolvedRole === "admin") {
    return { disabled: false, tooltip: "" };
  }

  const metadata = asMedicationMetadata(task);
  const acknowledgedBy = typeof metadata.acknowledgedBy === "string" ? metadata.acknowledgedBy : "";
  const meUserId = (meId ?? "").trim();
  const meClerk = (meClerkId ?? "").trim();
  const isAcknowledgedOwner =
    !!acknowledgedBy &&
    (acknowledgedBy === meUserId || (meClerk.length > 0 && acknowledgedBy === meClerk));
  if (!isAcknowledgedOwner) {
    return { disabled: true, tooltip: t.medsPage.completeDisabledAck };
  }
  return { disabled: false, tooltip: "" };
}

function startButtonState(args: {
  task: MedicationExecutionTask;
  meId?: string | null;
  role?: string | null;
  effectiveRole?: string | null;
}): { disabled: boolean; tooltip: string } {
  const { task, meId, role, effectiveRole } = args;
  const validStartStatuses = ["scheduled", "assigned", "arrived"];
  if (!validStartStatuses.includes(task.status)) {
    return { disabled: true, tooltip: t.medsPage.startDisabledStatus };
  }
  const resolvedRole = (effectiveRole || role || "").toLowerCase();
  if (resolvedRole === "admin" || resolvedRole === "vet" || resolvedRole === "senior_technician") {
    return { disabled: false, tooltip: "" };
  }
  const assignedTo = task.vetId;
  const meIdentifier = (meId ?? "").trim();
  if (!assignedTo) {
    return { disabled: true, tooltip: t.medsPage.startDisabledNoTech };
  }
  if (assignedTo !== meIdentifier) {
    return { disabled: true, tooltip: t.medsPage.startDisabledOtherTech };
  }
  return { disabled: false, tooltip: "" };
}

/** Read-only task card shown to vets — they see the task info but not the START/COMPLETE flow */
function VetTaskCard({ task }: { task: MedicationExecutionTask }) {
  const metadata = asMedicationMetadata(task);
  const drugName = resolveDrugName(task);
  const vetApproved = metadata.vetApproved === true;

  const desiredMg = Number.isFinite(metadata.desiredDoseMg) ? Number(metadata.desiredDoseMg) : null;
  const concentration = Number.isFinite(metadata.concentrationMgPerMl) ? Number(metadata.concentrationMgPerMl) : null;

  return (
    <div className="space-y-2 rounded-xl border border-border bg-background/50 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold truncate min-w-0" dir="auto">{drugName}</span>
        {vetApproved ? (
          <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 shrink-0">{t.medsPage.approved}</Badge>
        ) : (
          <Badge variant="secondary" className="shrink-0">{t.medsPage.awaitingApproval}</Badge>
        )}
      </div>
      {desiredMg != null ? (
        <div className="text-muted-foreground">{t.medsPage.prescribed(desiredMg.toFixed(2))}</div>
      ) : null}
      {concentration != null ? (
        <div className="text-muted-foreground">{t.medsPage.concentration(String(concentration))}</div>
      ) : null}
      {task.status === "in_progress" && !vetApproved ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
          {t.medsPage.awaitingApprovalNote}
        </div>
      ) : null}
    </div>
  );
}

export default function MedicationHubPage() {
  const queryClient = useQueryClient();
  const { userId, role, effectiveRole, isLoaded, isAdmin } = useAuth();
  const [formularySheetOpen, setFormularySheetOpen] = useState(false);
  const authReady = isLoaded;
  const { getByDrugName } = useDrugFormulary();
  const canExecuteTask = canExecuteMedicationTask(role, effectiveRole);
  const resolvedRole = String(effectiveRole ?? role ?? "").trim().toLowerCase();
  const canCreateMedicationTask = resolvedRole === "vet" || resolvedRole === "admin";

  const meQuery = useQuery({
    queryKey: ["/api/users/me"],
    queryFn: api.users.me,
    enabled: authReady,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const tasksQuery = useQuery({
    queryKey: ["/api/tasks/medication-active"],
    queryFn: api.tasks.medicationActive,
    enabled: authReady,
    refetchInterval: leaderPoll(30_000),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const startMutation = useMutation({
    mutationFn: (id: string) => api.tasks.start(id),
    onSuccess: () => {
      toast.success(t.medsPage.taskStarted);
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/medication-active"], exact: true });
    },
    onError: (error: Error) => toast.error(error.message || t.medsPage.taskStartFailed),
  });

  const completeMutation = useMutation({
    mutationFn: ({ taskId, payload }: { taskId: string; payload: MedicationExecutionPayload }) =>
      api.tasks.complete(taskId, { execution: payload }),
    onSuccess: () => {
      toast.success(t.medsPage.taskCompleted);
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/medication-active"], exact: true });
    },
    onError: (error: Error) => toast.error(error.message || t.medsPage.taskCompleteFailed),
  });

  const handleRealtimeEvent = useCallback((event: { type: string }) => {
    if (
      event.type === "TASK_UPDATED" ||
      event.type === "TASK_STARTED" ||
      event.type === "TASK_COMPLETED" ||
      event.type === "TASK_CREATED" ||
      event.type === "TASK_CANCELLED"
    ) {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/medication-active"], exact: true });
    }
  }, [queryClient]);

  useRealtime(handleRealtimeEvent);

  const tasks = useMemo(() => {
    return (tasksQuery.data ?? []).slice().sort((a, b) => {
      if (a.status !== b.status) {
        if (a.status === "in_progress") return -1;
        if (b.status === "in_progress") return 1;
      }
      return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
    });
  }, [tasksQuery.data]);

  // Students have no access to the medication hub; redirect to equipment.
  if (isLoaded && resolvedRole === "student") {
    return <Redirect to="/equipment" replace />;
  }

  const MEDS_SIDEBAR: SidebarItem[] = [
    { href: "/meds",              icon: Pill,    label: t.medsPage.title },
    { href: "/pharmacy-forecast", icon: Syringe, label: t.pharmacyForecast.navLabel },
  ];

  const isDesktop = typeof window !== "undefined" && window.innerWidth >= 1024;
  const pageContent = (
    <>
      <div className="space-y-4 pb-24">
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Pill className="h-6 w-6 text-primary" />
              {t.medsPage.title}
            </h1>
            {isAdmin && (
              <Button
                variant="outline"
                size="sm"
                className="h-9 text-xs"
                onClick={() => setFormularySheetOpen(true)}
              >
                <FlaskConical className="h-4 w-4 mr-1" />
                {t.medsPage.manageFormulary}
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {canExecuteTask ? t.medsPage.executeDesc : t.medsPage.prescribeDesc}
          </p>
        </div>

        {canCreateMedicationTask && <MedicationCalculator />}

        {tasksQuery.isLoading ? (
          <div className="space-y-3" role="status" aria-live="polite" aria-busy="true">
            <span className="sr-only">{t.common.loading}</span>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
              {t.common.loading}
            </p>
            <Skeleton className="h-56 w-full rounded-2xl" />
            <Skeleton className="h-56 w-full rounded-2xl" />
          </div>
        ) : null}

        {tasksQuery.isError ? (
          <ErrorCard
            message={t.medsPage.loadError}
            onRetry={() => tasksQuery.refetch()}
          />
        ) : null}

        {!tasksQuery.isLoading && !tasksQuery.isError && tasks.length === 0 ? (
          <EmptyState
            icon={Syringe}
            message={t.medsPage.emptyTitle}
            subMessage={t.medsPage.emptySubtitle}
          />
        ) : null}

        <div className="space-y-4">
          {tasks.map((task) => {
            const drugName = resolveDrugName(task);
            const formularyEntry = getByDrugName(drugName);

            return (
              <Card key={task.id} className="rounded-2xl border-2 border-border bg-card shadow-sm dark:border-border">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0 flex-1">
                      <CardTitle className="text-lg font-bold flex items-center gap-2 min-w-0">
                        <Beaker className="h-5 w-5 text-primary shrink-0" />
                        <span className="truncate" dir="auto">{drugName}</span>
                      </CardTitle>
                      <div className="text-xs text-muted-foreground">
                        {t.medsPage.taskLabel} • {task.status}
                      </div>
                    </div>
                    <Badge variant={task.status === "in_progress" ? "default" : "secondary"} className="shrink-0">
                      {statusLabel(task.status)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  {canExecuteTask ? (
                    <VerificationCalculator
                      task={task}
                      formularyEntry={formularyEntry ?? null}
                      currentUserId={userId}
                      currentUserClerkId={meQuery.data?.clerkId}
                      role={role}
                      effectiveRole={effectiveRole}
                      startDisabled={
                        startButtonState({ task, meId: userId, role, effectiveRole }).disabled ||
                        startMutation.isPending
                      }
                      startTooltip={startButtonState({ task, meId: userId, role, effectiveRole }).tooltip || undefined}
                      completeDisabled={completeButtonState({
                        task, meId: userId, meClerkId: meQuery.data?.clerkId, role, effectiveRole,
                      }).disabled}
                      completeTooltip={completeButtonState({
                        task, meId: userId, meClerkId: meQuery.data?.clerkId, role, effectiveRole,
                      }).tooltip || undefined}
                      isStarting={startMutation.isPending}
                      isCompleting={completeMutation.isPending}
                      onStart={(taskId) => startMutation.mutate(taskId)}
                      onComplete={(taskId, payload) => completeMutation.mutate({ taskId, payload })}
                    />
                  ) : (
                    <VetTaskCard task={task} />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
      {isAdmin && (
        <FormularyAdminSheet
          open={formularySheetOpen}
          onOpenChange={setFormularySheetOpen}
        />
      )}
    </>
  );
  if (isDesktop) {
    return <PageShell sidebarItems={MEDS_SIDEBAR}>{pageContent}</PageShell>;
  }
  return <Layout title={t.medsPage.title}>{pageContent}</Layout>;
}
