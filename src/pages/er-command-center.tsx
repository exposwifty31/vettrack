import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  acceptErPatient,
  ackErHandoff,
  assignErIntake,
  completeAdmission,
  createErHandoff,
  createErIntake,
  enrichErIntake,
  enterAdmissionState,
  getErAssignees,
  getErBoard,
  getErEligibleHospitalizations,
} from "@/lib/er-api";
import { connectRealtime, disconnectRealtime, EventIngestor } from "@/lib/realtime";
import type { ErBoardItem, ErBoardResponse, ErLane, ErSeverity } from "../../shared/er-types";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { t } from "@/lib/i18n";
import { toast } from "sonner";

import {
  ER_ASSIGNEES_QUERY_KEY,
  ER_BOARD_QUERY_KEY,
  ER_ELIGIBLE_HOSP_QUERY_KEY,
} from "@/lib/event-reducer";
import { CopDiscrepancyBanner } from "@/components/cop-discrepancy-banner";
import { CodeBlueAssistancePanel } from "@/components/er/code-blue-assistance-panel";
import { cn } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";
import { QrScanner } from "@/components/qr-scanner";
import { DispenseSheet } from "@/features/containers/components/DispenseSheet";
import { ErBoardLaneItemCard } from "@/features/er-board/components/ErBoardLaneItemCard";
import { InAdmissionStrip } from "@/components/er/InAdmissionStrip";

const ER_QUERY = ER_BOARD_QUERY_KEY;
const ASSIGNEES_QUERY = ER_ASSIGNEES_QUERY_KEY;
const ELIGIBLE_HOSP_QUERY = ER_ELIGIBLE_HOSP_QUERY_KEY;

const ACTIVE_ASSISTANCE_STORAGE_KEY = "vt_er_code_blue_assistance";

type HandoffFormRow = {
  currentStability: string;
  pendingTasks: string;
  criticalWarnings: string;
  activeIssue: string;
  nextAction: string;
  etaMinutes: string;
  ownerUserId: string;
};

function emptyHandoffRow(): HandoffFormRow {
  return {
    currentStability: "",
    pendingTasks: "",
    criticalWarnings: "",
    activeIssue: "",
    nextAction: "",
    etaMinutes: "60",
    ownerUserId: "",
  };
}

const SEVERITIES: ErSeverity[] = ["low", "medium", "high", "critical"];

/**
 * Primary Lane Enforcement: reads `item.lane` as the authoritative Primary Lane for each
 * ErBoardItem. Collapses any duplicate appearances from the server response (defensive guard)
 * to a single placement, preventing card duplication across columns.
 *
 * The Unified ER Event Stream drives all lane transitions via applyEvent(); this function
 * only enforces the single-placement invariant on each received board snapshot.
 */
function deduplicateByPrimaryLane(
  raw: ErBoardResponse["lanes"],
): Record<ErLane, ErBoardItem[]> {
  const seen = new Set<string>();
  const result: Record<ErLane, ErBoardItem[]> = {
    criticalNow: [],
    next15m: [],
    handoffRisk: [],
  };
  // Merge all server lane arrays and route each item by its authoritative item.lane field.
  const allItems = [...raw.criticalNow, ...raw.next15m, ...raw.handoffRisk];
  for (const item of allItems) {
    if (seen.has(item.id)) continue; // Enforce single-placement invariant — no card cloning.
    seen.add(item.id);
    result[item.lane].push(item);
  }
  return result;
}

function canAssignRole(role: string): boolean {
  return ["admin", "vet", "senior_technician", "technician"].includes(role);
}

function LaneColumn({
  title,
  items,
  assignees,
  canAssign,
  currentUserId,
  currentRole,
  onAssign,
  onAck,
  onForcedAckOverride,
  assigningId,
  ackingId,
  onScan,
  onAcceptPatient,
  onAdmissionComplete,
  onSubmitHandoff,
  onEnrichOwner,
}: {
  title: string;
  items: ErBoardItem[];
  assignees: { id: string; name: string }[];
  canAssign: boolean;
  currentUserId: string | null;
  currentRole: string;
  onAssign: (intakeId: string, userId: string) => void;
  onAck: (itemId: string) => void;
  onForcedAckOverride: (itemId: string) => void;
  assigningId: string | null;
  ackingId: string | null;
  onScan: (patientId: string) => void;
  onAcceptPatient?: (intakeId: string) => void;
  onAdmissionComplete?: (intakeId: string) => void;
  onSubmitHandoff?: (intakeId: string) => void;
  onEnrichOwner?: (intakeId: string, ownerName: string) => void;
}) {
  return (
    <Card className="flex min-h-[320px] flex-1 flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-2">
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm">—</p>
        ) : (
          items.map((item) => (
            <ErBoardLaneItemCard
              key={item.id}
              item={item}
              assignees={assignees}
              canAssign={canAssign}
              currentUserId={currentUserId}
              currentRole={currentRole}
              onAssign={onAssign}
              onAck={onAck}
              onForcedAckOverride={onForcedAckOverride}
              assigningId={assigningId}
              ackingId={ackingId}
              onScan={onScan}
              onAccept={onAcceptPatient}
              onAdmissionComplete={onAdmissionComplete}
              onSubmitHandoff={onSubmitHandoff}
              onEnrichOwner={onEnrichOwner}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

export default function ErCommandCenterPage() {
  const qc = useQueryClient();
  const auth = useAuth();
  const effectiveRole = auth.effectiveRole ?? auth.role ?? "";
  const assignRole = canAssignRole(effectiveRole);

  const [intakeOpen, setIntakeOpen] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffHospId, setHandoffHospId] = useState("");
  const [handoffItems, setHandoffItems] = useState<HandoffFormRow[]>([emptyHandoffRow()]);
  const [species, setSpecies] = useState("");
  const [severity, setSeverity] = useState<ErSeverity>("medium");
  const [complaint, setComplaint] = useState("");
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [ackingId, setAckingId] = useState<string | null>(null);

  // Forced Ack Override modal state.
  const [overrideTargetId, setOverrideTargetId] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [activePatientId, setActivePatientId] = useState<string | null>(null);
  const [scannedContainerId, setScannedContainerId] = useState<string | null>(null);
  const activePatientIdRef = useRef<string | null>(null);
  const [activeAssistanceOpen, setActiveAssistanceOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return sessionStorage.getItem(ACTIVE_ASSISTANCE_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    activePatientIdRef.current = activePatientId;
  }, [activePatientId]);

  useEffect(() => {
    try {
      if (activeAssistanceOpen) sessionStorage.setItem(ACTIVE_ASSISTANCE_STORAGE_KEY, "1");
      else sessionStorage.removeItem(ACTIVE_ASSISTANCE_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, [activeAssistanceOpen]);

  const handleScan = useCallback((patientId?: string) => {
    setScannedContainerId(null);
    if (patientId) {
      setActivePatientId(patientId);
      setScannerOpen(true);
      return;
    }
    if (!activePatientIdRef.current) {
      toast.info(t.erCommandCenter.quickScanPickPatientFirst);
      return;
    }
    setScannerOpen(true);
  }, []);

  const handleCloseScan = useCallback(() => {
    setScannerOpen(false);
    setActivePatientId(null);
    setScannedContainerId(null);
  }, []);

  const boardQ = useQuery({
    queryKey: ER_QUERY,
    queryFn: getErBoard,
  });

  const assigneesQ = useQuery({
    queryKey: ASSIGNEES_QUERY,
    queryFn: getErAssignees,
  });

  const eligibleHospQ = useQuery({
    queryKey: ELIGIBLE_HOSP_QUERY,
    queryFn: getErEligibleHospitalizations,
    enabled: handoffOpen && assignRole,
  });

  const assignees = useMemo(
    () => assigneesQ.data?.assignees.map((a) => ({ id: a.id, name: a.name })) ?? [],
    [assigneesQ.data],
  );

  const invalidateEr = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ER_QUERY });
    void qc.invalidateQueries({ queryKey: ASSIGNEES_QUERY });
    void qc.invalidateQueries({ queryKey: ELIGIBLE_HOSP_QUERY });
  }, [qc]);

  const realtimeIngestor = useMemo(() => new EventIngestor(qc), [qc]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await realtimeIngestor.replayHttpCatchUpAfter(realtimeIngestor.getLastAppliedEventId());
      } catch {
        // Replay is best-effort; SSE + cache queries still converge.
      }
      if (!cancelled) {
        connectRealtime(() => {}, { queryClient: qc, ingestor: realtimeIngestor });
      }
    })();
    return () => {
      cancelled = true;
      disconnectRealtime({ ingestor: realtimeIngestor });
      realtimeIngestor.dispose();
    };
  }, [qc, realtimeIngestor]);

  const createMut = useMutation({
    mutationFn: () =>
      createErIntake({
        species: species.trim(),
        severity,
        chiefComplaint: complaint.trim(),
      }),
    onSuccess: () => {
      toast.success("קבלה נוצרה");
      setIntakeOpen(false);
      setSpecies("");
      setComplaint("");
      setSeverity("medium");
      invalidateEr();
    },
    onError: () => toast.error("יצירת קבלה נכשלה"),
  });

  const assignMut = useMutation({
    mutationFn: ({ id, uid }: { id: string; uid: string }) => assignErIntake(id, { assignedUserId: uid }),
    onMutate: ({ id }) => setAssigningId(id),
    onSettled: () => setAssigningId(null),
    onSuccess: () => {
      toast.success("הוקצה");
      invalidateEr();
    },
    onError: () => toast.error("הקצאה נכשלה"),
  });

  const canDoctorAdmissionActions = ["admin", "vet"].includes(effectiveRole);

  const acceptMut = useMutation({
    mutationFn: async ({ intakeId, userId }: { intakeId: string; userId: string | null }) => {
      await acceptErPatient(intakeId, userId);
      if (userId !== null) {
        await enterAdmissionState(intakeId);
      }
    },
    onSuccess: () => {
      invalidateEr();
      void qc.invalidateQueries({ queryKey: ["er", "admission-state"] });
    },
    onError: () => toast.error("קבלת מטופל נכשלה"),
  });

  const enrichMut = useMutation({
    mutationFn: ({ intakeId, ownerName }: { intakeId: string; ownerName: string }) =>
      enrichErIntake(intakeId, { ownerName }),
    onSuccess: () => {
      toast.success(t.er.ownerLinked);
      invalidateEr();
    },
    onError: () => toast.error(t.er.enrichFailed),
  });

  const admissionCompleteMut = useMutation({
    mutationFn: (intakeId: string) => completeAdmission(intakeId),
    onSuccess: () => {
      invalidateEr();
      void qc.invalidateQueries({ queryKey: ["er", "admission-state"] });
    },
    onError: () => toast.error("השלמת קבלה נכשלה"),
  });

  const handoffMut = useMutation({
    mutationFn: () =>
      createErHandoff({
        hospitalizationId: handoffHospId.trim(),
        items: handoffItems.map((row) => ({
          currentStability: row.currentStability.trim(),
          pendingTasks: row.pendingTasks.trim(),
          criticalWarnings: row.criticalWarnings.trim(),
          activeIssue: row.activeIssue.trim(),
          nextAction: row.nextAction.trim(),
          etaMinutes: Math.min(2880, Math.max(0, Number.parseInt(row.etaMinutes, 10) || 0)),
          ownerUserId: row.ownerUserId.trim() ? row.ownerUserId.trim() : null,
        })),
      }),
    onSuccess: () => {
      toast.success("מסירה קלינית מובנית נוצרה");
      setHandoffOpen(false);
      setHandoffHospId("");
      setHandoffItems([emptyHandoffRow()]);
      invalidateEr();
    },
    onError: () => toast.error("מסירה נכשלה"),
  });

  // Incoming Assignee Ack: direct acknowledgment by the designated incoming owner.
  const ackMut = useMutation({
    mutationFn: (id: string) => ackErHandoff(id, {}),
    onMutate: (id) => setAckingId(id),
    onSettled: () => setAckingId(null),
    onSuccess: () => {
      toast.success("אושר");
      invalidateEr();
    },
    onError: () => toast.error("אישור נכשל"),
  });

  // Forced Ack Override: admin/vet acknowledges on behalf of the incoming owner.
  const overrideMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      ackErHandoff(id, { overrideReason: reason }),
    onMutate: ({ id }) => setAckingId(id),
    onSettled: () => setAckingId(null),
    onSuccess: () => {
      toast.success("עקיפת אישור נרשמה");
      setOverrideTargetId(null);
      setOverrideReason("");
      invalidateEr();
    },
    onError: () => toast.error("עקיפה נכשלה"),
  });

  // Primary Lane Enforcement: deduplicateByPrimaryLane guarantees each patient card is placed
  // in exactly one column, using item.lane as the authoritative source of truth.
  // The Unified ER Event Stream drives all transitions; this is a client-side safety net only.
  const lanes = deduplicateByPrimaryLane(
    boardQ.data?.lanes ?? { criticalNow: [], next15m: [], handoffRisk: [] },
  );

  const handoffFormInvalid =
    handoffMut.isPending ||
    !handoffHospId.trim() ||
    handoffItems.some(
      (r) =>
        !r.currentStability.trim() ||
        !r.pendingTasks.trim() ||
        !r.criticalWarnings.trim() ||
        !r.activeIssue.trim() ||
        !r.nextAction.trim(),
    );

  return (
    <Layout
      title={t.erCommandCenter.title}
      onScan={handleScan}
      scannerOpen={scannerOpen}
      onCloseScan={handleCloseScan}
    >
      <Helmet>
        <title>{t.erCommandCenter.title}</title>
      </Helmet>
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <CopDiscrepancyBanner />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2 md:gap-3">
            <h1 className="text-2xl font-bold">{t.erCommandCenter.title}</h1>
            <Button
              type="button"
              variant={activeAssistanceOpen ? "destructive" : "outline"}
              className={cn(
                "min-h-11 shrink-0 gap-2 border-2 font-semibold",
                activeAssistanceOpen && "shadow-md shadow-red-900/35",
              )}
              aria-pressed={activeAssistanceOpen}
              aria-expanded={activeAssistanceOpen}
              title={t.erCommandCenter.activeAssistance.toggleHint}
              onClick={() => setActiveAssistanceOpen((v) => !v)}
            >
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              {activeAssistanceOpen
                ? t.erCommandCenter.activeAssistance.toggleOn
                : t.erCommandCenter.activeAssistance.toggleOff}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {assignRole ? (
              <Dialog
                open={handoffOpen}
                onOpenChange={(o) => {
                  setHandoffOpen(o);
                  if (!o) {
                    setHandoffHospId("");
                    setHandoffItems([emptyHandoffRow()]);
                  }
                }}
              >
                <DialogTrigger asChild>
                  <Button variant="secondary">{t.erCommandCenter.createHandoff}</Button>
                </DialogTrigger>
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
                  <DialogHeader>
                    <DialogTitle>{t.erCommandCenter.createHandoff}</DialogTitle>
                  </DialogHeader>
                  <div className="grid gap-4 py-2">
                    <div className="grid gap-2">
                      <Label>{t.erCommandCenter.handoffPatient}</Label>
                      <Select value={handoffHospId || undefined} onValueChange={setHandoffHospId}>
                        <SelectTrigger>
                          <SelectValue placeholder={t.erCommandCenter.handoffSelectPatient} />
                        </SelectTrigger>
                        <SelectContent>
                          {(eligibleHospQ.data?.hospitalizations ?? []).map((h) => (
                            <SelectItem key={h.id} value={h.id}>
                              {h.animalName} · {h.status}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {!eligibleHospQ.isLoading &&
                      (eligibleHospQ.data?.hospitalizations.length ?? 0) === 0 ? (
                        <p className="text-muted-foreground text-xs">{t.erCommandCenter.handoffNoPatients}</p>
                      ) : null}
                    </div>
                    {handoffItems.map((row, idx) => (
                      <div key={idx} className="border-border space-y-3 rounded-md border p-3">
                        <div className="text-muted-foreground text-xs font-medium">
                          {t.erCommandCenter.handoffItem(idx + 1)}
                        </div>
                        {/* Structured Clinical Handoff — mandatory artifact fields */}
                        <div className="grid gap-2">
                          <Label>{t.erCommandCenter.handoffCurrentStability}</Label>
                          <Textarea
                            value={row.currentStability}
                            onChange={(e) => {
                              const v = e.target.value;
                              setHandoffItems((prev) =>
                                prev.map((r, i) => (i === idx ? { ...r, currentStability: v } : r)),
                              );
                            }}
                            rows={2}
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label>{t.erCommandCenter.handoffPendingTasks}</Label>
                          <Textarea
                            value={row.pendingTasks}
                            onChange={(e) => {
                              const v = e.target.value;
                              setHandoffItems((prev) =>
                                prev.map((r, i) => (i === idx ? { ...r, pendingTasks: v } : r)),
                              );
                            }}
                            rows={2}
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label>{t.erCommandCenter.handoffCriticalWarnings}</Label>
                          <Textarea
                            value={row.criticalWarnings}
                            onChange={(e) => {
                              const v = e.target.value;
                              setHandoffItems((prev) =>
                                prev.map((r, i) => (i === idx ? { ...r, criticalWarnings: v } : r)),
                              );
                            }}
                            rows={2}
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label>{t.erCommandCenter.handoffActiveIssue}</Label>
                          <Textarea
                            value={row.activeIssue}
                            onChange={(e) => {
                              const v = e.target.value;
                              setHandoffItems((prev) =>
                                prev.map((r, i) => (i === idx ? { ...r, activeIssue: v } : r)),
                              );
                            }}
                            rows={2}
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label>{t.erCommandCenter.handoffNextAction}</Label>
                          <Textarea
                            value={row.nextAction}
                            onChange={(e) => {
                              const v = e.target.value;
                              setHandoffItems((prev) =>
                                prev.map((r, i) => (i === idx ? { ...r, nextAction: v } : r)),
                              );
                            }}
                            rows={2}
                          />
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div className="grid gap-2">
                            <Label>{t.erCommandCenter.handoffEtaMinutes}</Label>
                            <Input
                              inputMode="numeric"
                              value={row.etaMinutes}
                              onChange={(e) => {
                                const v = e.target.value;
                                setHandoffItems((prev) =>
                                  prev.map((r, i) => (i === idx ? { ...r, etaMinutes: v } : r)),
                                );
                              }}
                            />
                          </div>
                          <div className="grid gap-2">
                            <Label>{t.erCommandCenter.handoffOwner}</Label>
                            <Select
                              value={row.ownerUserId || "__none__"}
                              onValueChange={(uid) => {
                                const v = uid === "__none__" ? "" : uid;
                                setHandoffItems((prev) =>
                                  prev.map((r, i) => (i === idx ? { ...r, ownerUserId: v } : r)),
                                );
                              }}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder={t.erCommandCenter.handoffOwnerUnassigned} />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">{t.erCommandCenter.handoffOwnerUnassigned}</SelectItem>
                                {assignees.map((a) => (
                                  <SelectItem key={a.id} value={a.id}>
                                    {a.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => setHandoffItems((prev) => [...prev, emptyHandoffRow()])}
                    >
                      {t.erCommandCenter.handoffAddItem}
                    </Button>
                  </div>
                  <DialogFooter>
                    <Button
                      disabled={handoffFormInvalid}
                      onClick={() => handoffMut.mutate()}
                    >
                      {t.erCommandCenter.handoffSubmit}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            ) : null}
            <Dialog open={intakeOpen} onOpenChange={setIntakeOpen}>
              <DialogTrigger asChild>
                <Button>{t.erCommandCenter.quickIntake}</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t.erCommandCenter.quickIntake}</DialogTitle>
                </DialogHeader>
                <div className="grid gap-3 py-2">
                  <div className="grid gap-2">
                    <Label>{t.erCommandCenter.species}</Label>
                    <Input value={species} onChange={(e) => setSpecies(e.target.value)} />
                  </div>
                  <div className="grid gap-2">
                    <Label>{t.erCommandCenter.severity}</Label>
                    <Select value={severity} onValueChange={(v) => setSeverity(v as ErSeverity)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SEVERITIES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>{t.erCommandCenter.complaint}</Label>
                    <Input value={complaint} onChange={(e) => setComplaint(e.target.value)} />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    disabled={createMut.isPending || !species.trim() || !complaint.trim()}
                    onClick={() => createMut.mutate()}
                  >
                    {t.erCommandCenter.submitIntake}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Button variant="outline" asChild>
              <Link href="/er/impact">{t.erCommandCenter.impactLink}</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/er/kpis">Outcome KPIs</Link>
            </Button>
            <Button variant="ghost" onClick={() => void boardQ.refetch()}>
              {t.erCommandCenter.refresh}
            </Button>
          </div>
        </div>

        {activeAssistanceOpen ? <CodeBlueAssistancePanel /> : null}

        {boardQ.isLoading ? (
          <p className="text-muted-foreground">{t.erCommandCenter.loadingBoard}</p>
        ) : boardQ.isError ? (
          <p className="text-destructive">Load failed</p>
        ) : (
          <>
            <InAdmissionStrip />
            <div className="flex flex-col gap-4 lg:flex-row">
              <LaneColumn
                title={t.erCommandCenter.lanes.criticalNow}
                items={lanes.criticalNow}
                assignees={assignees}
                canAssign={assignRole}
                currentUserId={auth.userId}
                currentRole={effectiveRole}
                assigningId={assigningId}
                ackingId={ackingId}
                onAssign={(id, uid) => assignMut.mutate({ id, uid })}
                onAck={(id) => ackMut.mutate(id)}
                onForcedAckOverride={(id) => {
                  setOverrideTargetId(id);
                  setOverrideReason("");
                }}
                onScan={handleScan}
                onAcceptPatient={
                  canDoctorAdmissionActions && auth.userId
                    ? (intakeId) => acceptMut.mutate({ intakeId, userId: auth.userId })
                    : undefined
                }
                onAdmissionComplete={
                  canDoctorAdmissionActions
                    ? (intakeId) => admissionCompleteMut.mutate(intakeId)
                    : undefined
                }
                onSubmitHandoff={(_intakeId) => {
                  setHandoffOpen(true);
                }}
                onEnrichOwner={
                  canDoctorAdmissionActions
                    ? (intakeId, ownerName) => enrichMut.mutate({ intakeId, ownerName })
                    : undefined
                }
              />
              <LaneColumn
                title={t.erCommandCenter.lanes.next15m}
                items={lanes.next15m}
                assignees={assignees}
                canAssign={assignRole}
                currentUserId={auth.userId}
                currentRole={effectiveRole}
                assigningId={assigningId}
                ackingId={ackingId}
                onAssign={(id, uid) => assignMut.mutate({ id, uid })}
                onAck={(id) => ackMut.mutate(id)}
                onForcedAckOverride={(id) => {
                  setOverrideTargetId(id);
                  setOverrideReason("");
                }}
                onScan={handleScan}
                onAcceptPatient={
                  canDoctorAdmissionActions && auth.userId
                    ? (intakeId) => acceptMut.mutate({ intakeId, userId: auth.userId })
                    : undefined
                }
                onAdmissionComplete={
                  canDoctorAdmissionActions
                    ? (intakeId) => admissionCompleteMut.mutate(intakeId)
                    : undefined
                }
                onSubmitHandoff={(_intakeId) => {
                  setHandoffOpen(true);
                }}
                onEnrichOwner={
                  canDoctorAdmissionActions
                    ? (intakeId, ownerName) => enrichMut.mutate({ intakeId, ownerName })
                    : undefined
                }
              />
              <LaneColumn
                title={t.erCommandCenter.lanes.handoffRisk}
                items={lanes.handoffRisk}
                assignees={assignees}
                canAssign={assignRole}
                currentUserId={auth.userId}
                currentRole={effectiveRole}
                assigningId={assigningId}
                ackingId={ackingId}
                onAssign={(id, uid) => assignMut.mutate({ id, uid })}
                onAck={(id) => ackMut.mutate(id)}
                onForcedAckOverride={(id) => {
                  setOverrideTargetId(id);
                  setOverrideReason("");
                }}
                onScan={handleScan}
                onAcceptPatient={
                  canDoctorAdmissionActions && auth.userId
                    ? (intakeId) => acceptMut.mutate({ intakeId, userId: auth.userId })
                    : undefined
                }
                onAdmissionComplete={
                  canDoctorAdmissionActions
                    ? (intakeId) => admissionCompleteMut.mutate(intakeId)
                    : undefined
                }
                onSubmitHandoff={(_intakeId) => {
                  setHandoffOpen(true);
                }}
                onEnrichOwner={
                  canDoctorAdmissionActions
                    ? (intakeId, ownerName) => enrichMut.mutate({ intakeId, ownerName })
                    : undefined
                }
              />
            </div>
          </>
        )}
      </div>

      {scannerOpen && activePatientId && !scannedContainerId ? (
        <QrScanner
          onClose={handleCloseScan}
          onDispense={(containerId) => {
            setScannedContainerId(containerId);
          }}
        />
      ) : null}

      {scannerOpen && activePatientId && scannedContainerId ? (
        <DispenseSheet
          containerId={scannedContainerId}
          isOpen
          patientId={activePatientId}
          onClose={handleCloseScan}
        />
      ) : null}

      {/* Forced Ack Override modal — admin/vet must provide a mandatory reason. */}
      <Dialog
        open={overrideTargetId !== null}
        onOpenChange={(o) => {
          if (!o) {
            setOverrideTargetId(null);
            setOverrideReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.erCommandCenter.overrideModalTitle}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <p className="text-muted-foreground text-sm">{t.erCommandCenter.overrideModalDesc}</p>
            <div className="grid gap-2">
              <Label>{t.erCommandCenter.overrideReasonLabel}</Label>
              <Textarea
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                rows={3}
                placeholder={t.erCommandCenter.overrideReasonPlaceholder}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setOverrideTargetId(null);
                setOverrideReason("");
              }}
            >
              {t.erCommandCenter.overrideCancel}
            </Button>
            <Button
              disabled={!overrideReason.trim() || overrideMut.isPending}
              onClick={() => {
                if (overrideTargetId && overrideReason.trim()) {
                  overrideMut.mutate({ id: overrideTargetId, reason: overrideReason.trim() });
                }
              }}
            >
              {t.erCommandCenter.overrideConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
