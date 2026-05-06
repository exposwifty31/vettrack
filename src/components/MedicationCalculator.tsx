import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Pencil, Trash2, X } from "lucide-react";
import { useFormulary } from "@/hooks/useFormulary";
import { useDrugFormulary } from "@/hooks/useDrugFormulary";
import type { DrugFormularyPatch } from "@/hooks/useDrugFormulary";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/lib/api";
import {
  blockReasonMessage,
  buildMedicationAppointmentRequest,
  calculateDoseFromMg,
  resolveUICase,
  type ClinicalEnrichment,
  type ResolvedDose,
  type SafeCalcResult,
} from "@/lib/medicationHelpers";
import { evaluateMedicationRbac } from "@/lib/medicationRbac";
import type { Appointment, DrugFormularyEntry } from "@/types";

function BlockAlert({ reason }: { reason: SafeCalcResult["blockReason"] }) {
  if (!reason) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800"
    >
      <span className="text-lg leading-none" aria-hidden>⛔</span>
      <span>{blockReasonMessage(reason)}</span>
    </div>
  );
}

interface StaffUser {
  id: string;
  name: string;
  displayName?: string;
  role: string;
}


function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function canManageFormulary(role: string | null | undefined): boolean {
  const r = String(role ?? "").trim().toLowerCase();
  return r === "vet" || r === "admin";
}

function doseUnitLabel(unit: "mg_per_kg" | "mcg_per_kg" | "mEq_per_kg" | "tablet"): string {
  if (unit === "mcg_per_kg") return "mcg/kg";
  if (unit === "mEq_per_kg") return "mEq/kg";
  if (unit === "tablet") return "tab/kg";
  return "mg/kg";
}

function concentrationUnitLabel(unit: "mg_per_kg" | "mcg_per_kg" | "mEq_per_kg" | "tablet"): string {
  if (unit === "mEq_per_kg") return "mEq/mL";
  if (unit === "tablet") return "mg/tab";
  return "mg/mL";
}

function concentrationDisplay(name: string, concentration: number, unit: "mg_per_kg" | "mcg_per_kg" | "mEq_per_kg" | "tablet"): string {
  const base = `${concentration} ${concentrationUnitLabel(unit)}`;
  if (unit === "tablet" || unit === "mEq_per_kg") return base;
  const percentMatch = name.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!percentMatch) return base;
  const percent = Number.parseFloat(percentMatch[1]);
  if (!Number.isFinite(percent) || percent <= 0) return base;
  return `${percent}% (${base})`;
}

function formatTabletFraction(tablets: number): string {
  const rounded = Math.round(tablets * 4) / 4;
  const whole = Math.trunc(rounded);
  const fraction = Math.round((rounded - whole) * 4);
  const fractionLabel =
    fraction === 0 ? "" : fraction === 1 ? "1/4" : fraction === 2 ? "1/2" : "3/4";
  if (whole === 0 && fractionLabel) return fractionLabel;
  if (!fractionLabel) return String(whole);
  return `${whole} ${fractionLabel}`;
}

// ─── Formulary Manager ───────────────────────────────────────────────────────

interface FormularyManagerProps {
  onClose: () => void;
}

function FormularyManager({ onClose }: FormularyManagerProps) {
  const { formulary: rawList, isLoading } = useFormulary();
  const { upsertDrug, updateDrug, deleteDrug } = useDrugFormulary();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editConc, setEditConc] = useState("");
  const [editDose, setEditDose] = useState("");
  const [editMinDose, setEditMinDose] = useState("");
  const [editMaxDose, setEditMaxDose] = useState("");
  const [editUnit, setEditUnit] = useState<"mg_per_kg" | "mcg_per_kg" | "mEq_per_kg" | "tablet">("mg_per_kg");
  const [editRoute, setEditRoute] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addConc, setAddConc] = useState("");
  const [addDose, setAddDose] = useState("");
  const [addMinDose, setAddMinDose] = useState("");
  const [addMaxDose, setAddMaxDose] = useState("");
  const [addUnit, setAddUnit] = useState<"mg_per_kg" | "mcg_per_kg" | "mEq_per_kg" | "tablet">("mg_per_kg");
  const [addRoute, setAddRoute] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function startEdit(entry: DrugFormularyEntry) {
    setEditingId(entry.id);
    setEditConc(String(entry.concentrationMgMl));
    setEditDose(String(entry.standardDose));
    setEditMinDose(entry.minDose != null ? String(entry.minDose) : "");
    setEditMaxDose(entry.maxDose != null ? String(entry.maxDose) : "");
    setEditUnit(entry.doseUnit);
    setEditRoute(entry.defaultRoute ?? "");
    setError(null);
  }

  async function submitEdit(id: string) {
    const conc = Number.parseFloat(editConc);
    const dose = Number.parseFloat(editDose);
    if (!Number.isFinite(conc) || conc <= 0 || !Number.isFinite(dose) || dose <= 0) {
      setError("Enter valid positive numbers.");
      return;
    }
    const minD = editMinDose ? Number.parseFloat(editMinDose) : null;
    const maxD = editMaxDose ? Number.parseFloat(editMaxDose) : null;
    setBusy(true);
    setError(null);
    try {
      const patch: DrugFormularyPatch = {
        concentrationMgMl: conc,
        standardDose: dose,
        minDose: minD && Number.isFinite(minD) && minD > 0 ? minD : null,
        maxDose: maxD && Number.isFinite(maxD) && maxD > 0 ? maxD : null,
        doseUnit: editUnit,
        defaultRoute: editRoute.trim() || null,
      };
      await updateDrug(id, patch);
      setEditingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  }

  async function submitDelete(id: string) {
    if (!confirm("Delete this drug from the formulary?")) return;
    setBusy(true);
    setError(null);
    try {
      await deleteDrug(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  async function submitAdd() {
    const name = addName.trim();
    const conc = Number.parseFloat(addConc);
    const dose = Number.parseFloat(addDose);
    if (!name) { setError("Drug name is required."); return; }
    if (!Number.isFinite(conc) || conc <= 0) { setError("Enter valid concentration."); return; }
    if (!Number.isFinite(dose) || dose <= 0) { setError("Enter valid standard dose."); return; }
    const minD = addMinDose ? Number.parseFloat(addMinDose) : null;
    const maxD = addMaxDose ? Number.parseFloat(addMaxDose) : null;
    setBusy(true);
    setError(null);
    try {
      await upsertDrug({
        name,
        genericName: name,
        concentrationMgMl: conc,
        standardDose: dose,
        minDose: minD && Number.isFinite(minD) && minD > 0 ? minD : null,
        maxDose: maxD && Number.isFinite(maxD) && maxD > 0 ? maxD : null,
        doseUnit: addUnit,
        defaultRoute: addRoute.trim() || null,
      });
      setAddName(""); setAddConc(""); setAddDose(""); setAddMinDose(""); setAddMaxDose(""); setAddUnit("mg_per_kg"); setAddRoute("");
      setAddOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Add failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">Manage Formulary</span>
        <button type="button" onClick={onClose} aria-label="Close formulary manager" className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {error ? (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</div>
      ) : null}

      {isLoading ? (
        <div className="text-xs text-muted-foreground">טוען...</div>
      ) : (
        <div className="space-y-2">
          {rawList.map((entry) => (
            <div key={entry.id} className="rounded-lg border border-border bg-background p-2.5">
              {editingId === entry.id ? (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-foreground">{entry.name}</div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground">Conc (mg/mL)</label>
                      <input
                        type="number" inputMode="decimal" min="0.001" step="0.001" value={editConc}
                        onChange={(e) => setEditConc(e.target.value)}
                        className="w-full rounded border border-input px-2 py-1 text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Std dose</label>
                      <input
                        type="number" inputMode="decimal" min="0.001" step="0.001" value={editDose}
                        onChange={(e) => setEditDose(e.target.value)}
                        className="w-full rounded border border-input px-2 py-1 text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Unit</label>
                      <select
                        value={editUnit} onChange={(e) => setEditUnit(e.target.value as "mg_per_kg" | "mcg_per_kg" | "mEq_per_kg" | "tablet")}
                        className="w-full rounded border border-input px-2 py-1 text-xs"
                      >
                        <option value="mg_per_kg">mg/kg</option>
                        <option value="mcg_per_kg">mcg/kg</option>
                        <option value="mEq_per_kg">mEq/kg</option>
                        <option value="tablet">tablet</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground">Min dose</label>
                      <input type="number" inputMode="decimal" min="0.001" step="0.001" value={editMinDose}
                        onChange={(e) => setEditMinDose(e.target.value)}
                        placeholder="optional"
                        className="w-full rounded border border-input px-2 py-1 text-xs" />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Max dose</label>
                      <input type="number" inputMode="decimal" min="0.001" step="0.001" value={editMaxDose}
                        onChange={(e) => setEditMaxDose(e.target.value)}
                        placeholder="optional"
                        className="w-full rounded border border-input px-2 py-1 text-xs" />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Route</label>
                      <input type="text" value={editRoute}
                        onChange={(e) => setEditRoute(e.target.value)}
                        placeholder="e.g. IV/IM"
                        className="w-full rounded border border-input px-2 py-1 text-xs" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button" disabled={busy}
                      onClick={() => submitEdit(entry.id)}
                      className="rounded bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                      title={busy ? "Saving…" : undefined}
                    >
                      Save
                    </button>
                    <button
                      type="button" onClick={() => setEditingId(null)}
                      className="rounded border border-border px-3 py-1 text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold">{entry.name}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {entry.concentrationMgMl} {entry.doseUnit === "tablet" ? "mg/tab" : "mg/mL"} •{" "}
                      {entry.minDose != null && entry.maxDose != null
                        ? `${entry.minDose}–${entry.maxDose}`
                        : String(entry.standardDose)}{" "}
                      {entry.doseUnit === "mcg_per_kg" ? "mcg/kg"
                        : entry.doseUnit === "mEq_per_kg" ? "mEq/kg"
                        : entry.doseUnit === "tablet" ? "tab/kg"
                        : "mg/kg"}
                      {entry.defaultRoute ? ` • ${entry.defaultRoute}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button" onClick={() => startEdit(entry)} disabled={busy}
                      className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-40"
                      title="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button" onClick={() => submitDelete(entry.id)} disabled={busy}
                      className="p-1 text-red-500 hover:text-red-700 disabled:opacity-40"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {addOpen ? (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
          <div className="text-xs font-semibold text-foreground">New Drug</div>
          <input
            type="text" placeholder="Drug name" value={addName}
            onChange={(e) => setAddName(e.target.value)}
            className="w-full rounded border border-input px-2 py-1.5 text-xs"
          />
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground">Conc (mg/mL)</label>
              <input type="number" inputMode="decimal" min="0.001" step="0.001" value={addConc}
                onChange={(e) => setAddConc(e.target.value)}
                className="w-full rounded border border-input px-2 py-1 text-xs"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Std dose</label>
              <input type="number" inputMode="decimal" min="0.001" step="0.001" value={addDose}
                onChange={(e) => setAddDose(e.target.value)}
                className="w-full rounded border border-input px-2 py-1 text-xs"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Unit</label>
              <select value={addUnit} onChange={(e) => setAddUnit(e.target.value as "mg_per_kg" | "mcg_per_kg" | "mEq_per_kg" | "tablet")}
                className="w-full rounded border border-input px-2 py-1 text-xs"
              >
                <option value="mg_per_kg">mg/kg</option>
                <option value="mcg_per_kg">mcg/kg</option>
                <option value="mEq_per_kg">mEq/kg</option>
                <option value="tablet">tablet</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground">Min dose</label>
              <input type="number" inputMode="decimal" min="0.001" step="0.001" value={addMinDose}
                onChange={(e) => setAddMinDose(e.target.value)} placeholder="optional"
                className="w-full rounded border border-input px-2 py-1 text-xs" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Max dose</label>
              <input type="number" inputMode="decimal" min="0.001" step="0.001" value={addMaxDose}
                onChange={(e) => setAddMaxDose(e.target.value)} placeholder="optional"
                className="w-full rounded border border-input px-2 py-1 text-xs" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Route</label>
              <input type="text" value={addRoute}
                onChange={(e) => setAddRoute(e.target.value)} placeholder="e.g. IV/IM"
                className="w-full rounded border border-input px-2 py-1 text-xs" />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button" disabled={busy} onClick={submitAdd}
              className="rounded bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed"
              title={busy ? "Adding…" : undefined}
            >
              Add
            </button>
            <button
              type="button" onClick={() => { setAddOpen(false); setError(null); }}
              className="rounded border border-border px-3 py-1 text-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button" onClick={() => setAddOpen(true)}
          className="w-full rounded-lg border border-dashed border-primary/40 px-3 py-2 text-xs font-medium text-primary hover:bg-primary/5"
        >
          + Add drug
        </button>
      )}
    </div>
  );
}

// ─── Main calculator ──────────────────────────────────────────────────────────

export function MedicationCalculator({
  defaultWeightKg,
  animalId = null,
  initialDrugName = "",
  clinicalEnrichment,
  onSuccess,
  onComplete,
  onCancel,
}: {
  defaultWeightKg?: number | null;
  animalId?: string | null;
  initialDrugName?: string;
  clinicalEnrichment?: ClinicalEnrichment;
  onSuccess?: (taskId: string) => void;
  onComplete?: (appointment: Appointment) => void;
  onCancel?: () => void;
}) {
  const queryClient = useQueryClient();
  const { userId, role, effectiveRole } = useAuth();
  const { formulary: formularyList, isLoading: formularyLoading, resolveEntry } = useFormulary();

  const rbac = evaluateMedicationRbac({ id: userId ?? undefined, role, effectiveRole });

  const storageKeyRef = useRef(`vt_med_calc_${animalId ?? "global"}`);

  const [selectedDrugName, setSelectedDrugName] = useState(() => {
    try {
      const saved = sessionStorage.getItem(storageKeyRef.current);
      if (saved) return (JSON.parse(saved) as { drugName?: string }).drugName ?? initialDrugName;
    } catch { /* ignore */ }
    return initialDrugName;
  });
  const [weightKgRaw, setWeightKgRaw] = useState(() => {
    try {
      const saved = sessionStorage.getItem(storageKeyRef.current);
      if (saved) return (JSON.parse(saved) as { weightKgRaw?: string }).weightKgRaw ?? (defaultWeightKg != null ? String(defaultWeightKg) : "");
    } catch { /* ignore */ }
    return defaultWeightKg != null ? String(defaultWeightKg) : "";
  });
  const [desiredMgRaw, setDesiredMgRaw] = useState(() => {
    try {
      const saved = sessionStorage.getItem(storageKeyRef.current);
      if (saved) return (JSON.parse(saved) as { desiredMgRaw?: string }).desiredMgRaw ?? "";
    } catch { /* ignore */ }
    return "";
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [showFormularyManager, setShowFormularyManager] = useState(false);
  const submittingRef = useRef(false);
  const [technicians, setTechnicians] = useState<StaffUser[]>([]);
  const [selectedTechnicianId, setSelectedTechnicianId] = useState("");
  const [isTechnicianLoading, setIsTechnicianLoading] = useState(true);
  const [technicianLoadError, setTechnicianLoadError] = useState<string | null>(null);
  const currentUserCanExecuteMedication = userId ? technicians.some((u) => u.id === userId) : false;
  const userCanManageFormulary = canManageFormulary(effectiveRole ?? role);

  const fetchTechnicians = useCallback(async () => {
    setIsTechnicianLoading(true);
    setTechnicianLoadError(null);
    try {
      const meta = await api.appointments.meta(todayIsoDate());
      const eligible = meta.technicians.map((user) => ({
        id: user.id,
        name: user.displayName?.trim() || user.name?.trim() || user.id,
        displayName: user.displayName,
        role: user.role,
      }));

      setTechnicians(eligible);
      if (eligible.length === 0) {
        setSelectedTechnicianId("");
        return;
      }

      const currentUserOption = userId ? eligible.find((u) => u.id === userId) : undefined;
      if (currentUserCanExecuteMedication && currentUserOption) {
        setSelectedTechnicianId(currentUserOption.id);
        return;
      }

      setSelectedTechnicianId((prev) =>
        eligible.some((u) => u.id === prev) ? prev : eligible[0].id,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load technician list.";
      setTechnicianLoadError(message);
      setTechnicians([]);
      setSelectedTechnicianId("");
    } finally {
      setIsTechnicianLoading(false);
    }
  }, [currentUserCanExecuteMedication, userId]);

  useEffect(() => {
    if (weightKgRaw !== "") return;
    if (defaultWeightKg != null && Number.isFinite(defaultWeightKg) && defaultWeightKg > 0) {
      setWeightKgRaw(String(defaultWeightKg));
    }
  }, [defaultWeightKg, weightKgRaw]);

  useEffect(() => {
    fetchTechnicians();
  }, [fetchTechnicians]);

  const weightKg = Number.parseFloat(weightKgRaw);
  const desiredMg = Number.parseFloat(desiredMgRaw);

  const resolved: ResolvedDose | null = useMemo(() => {
    if (!selectedDrugName) return null;
    return resolveEntry(selectedDrugName, clinicalEnrichment);
  }, [clinicalEnrichment, resolveEntry, selectedDrugName]);

  const uiCase = resolved ? resolveUICase(resolved) : "BROKEN";

  const calc: SafeCalcResult = useMemo(() => {
    if (!resolved) {
      return { totalMg: 0, volumeMl: 0, deviationPercent: null, blockReason: "INVALID_DOSE", isBlocked: true };
    }
    return calculateDoseFromMg(
      desiredMg,
      resolved.concentrationMgPerMl,
      resolved.recommendedDoseMgPerKg,
      Number.isFinite(weightKg) && weightKg > 0 ? weightKg : undefined,
    );
  }, [desiredMg, resolved, weightKg]);

  // Persist calculator inputs to sessionStorage so navigating away doesn't lose work
  useEffect(() => {
    try {
      if (selectedDrugName || weightKgRaw || desiredMgRaw) {
        sessionStorage.setItem(storageKeyRef.current, JSON.stringify({ drugName: selectedDrugName, weightKgRaw, desiredMgRaw }));
      }
    } catch { /* ignore */ }
  }, [selectedDrugName, weightKgRaw, desiredMgRaw]);

  // Reset dose and messages when drug changes
  useEffect(() => {
    if (!selectedDrugName) return;
    setSuccessMessage(null);
    setApiError(null);
    setDesiredMgRaw("");
  }, [selectedDrugName]);

  // Smart defaults: selecting a drug + valid patient weight pre-fills desired mg
  // from the recommended mg/kg value, while still allowing manual edits.
  useEffect(() => {
    if (!resolved) return;
    if (!Number.isFinite(weightKg) || weightKg <= 0) return;
    if (desiredMgRaw.trim() !== "") return;
    if (!Number.isFinite(resolved.recommendedDoseMgPerKg) || (resolved.recommendedDoseMgPerKg ?? 0) <= 0) return;
    const recommendedTotalMg = (resolved.recommendedDoseMgPerKg as number) * weightKg;
    if (!Number.isFinite(recommendedTotalMg) || recommendedTotalMg <= 0) return;
    setDesiredMgRaw(recommendedTotalMg.toFixed(3).replace(/\.?0+$/, ""));
  }, [resolved, desiredMgRaw, weightKg]);

  const resolvePerformerId = useCallback((): string | null => {
    const currentUserOption = userId ? technicians.find((u) => u.id === userId) : undefined;
    if (!selectedTechnicianId) {
      if (currentUserCanExecuteMedication && currentUserOption) return currentUserOption.id;
      return null;
    }
    const selectedOption = technicians.find((u) => u.id === selectedTechnicianId);
    if (selectedOption) return selectedOption.id;
    if (currentUserCanExecuteMedication && currentUserOption) return currentUserOption.id;
    return null;
  }, [currentUserCanExecuteMedication, selectedTechnicianId, technicians, userId]);

  const performerId = resolvePerformerId();
  const noTechniciansAvailable = !isTechnicianLoading && technicians.length === 0;

  const weightIsValid = Number.isFinite(weightKg) && weightKg > 0;

  const canExecute =
    !calc.isBlocked &&
    !isSubmitting &&
    !!resolved &&
    weightIsValid &&
    !isTechnicianLoading &&
    !technicianLoadError &&
    !noTechniciansAvailable &&
    !!performerId;

  const giveMedicationMutation = useMutation({
    mutationFn: async (): Promise<Appointment | void> => {
      if (submittingRef.current) return;
      if (!canExecute || !resolved || !rbac.permittedVetId) return;
      if (calc.isBlocked || calc.blockReason !== null) throw new Error("This dose is blocked.");
      if (!Number.isFinite(calc.volumeMl) || calc.volumeMl <= 0) throw new Error("Invalid calculated volume.");

      submittingRef.current = true;
      setIsSubmitting(true);
      setApiError(null);
      setSuccessMessage(null);

      const payload = buildMedicationAppointmentRequest({
        actorIdentifier: userId ?? null,
        animalId,
        userId: performerId!,
        drugName: selectedDrugName,
        weightKg: Number.isFinite(weightKg) && weightKg > 0 ? weightKg : undefined,
        desiredMg,
        resolvedDose: resolved,
        calcResult: calc,
      });

      const appointment = await api.appointments.create(payload);
      if (!appointment?.id) throw new Error("Medication task created but no ID returned.");

      await queryClient.invalidateQueries({ queryKey: ["/api/tasks/medication-active"], exact: true });
      onSuccess?.(appointment.id);
      return appointment;
    },
    onSuccess: (appointment) => {
      try { sessionStorage.removeItem(storageKeyRef.current); } catch { /* ignore */ }
      setSuccessMessage(`Medication task created — ${calc.volumeMl.toFixed(2)} mL assigned to technician.`);
      if (appointment) {
        onSuccess?.(appointment.id);
        onComplete?.(appointment);
      }
    },
    onError: (err: unknown) => {
      setApiError(err instanceof Error ? err.message : "An unexpected error occurred.");
    },
    onSettled: () => {
      submittingRef.current = false;
      setIsSubmitting(false);
    },
  });

  const handleGiveMedication = useCallback(() => {
    if (!rbac.permittedVetId) {
      setApiError("No valid technician selected.");
      return;
    }
    giveMedicationMutation.mutate();
  }, [giveMedicationMutation, rbac.permittedVetId]);

  if (formularyLoading) {
    return <div className="flex items-center justify-center p-8 text-muted-foreground">Loading formulary...</div>;
  }

  if (rbac.canExecute === "blocked") {
    return (
      <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-6 text-center text-red-800">
        <p className="mb-1 text-lg font-semibold">Access Denied</p>
        <p className="text-sm">{rbac.blockReason}</p>
      </div>
    );
  }

  // Dosage range display text
  const doseRangeText = (() => {
    if (!resolved) return null;
    const std = resolved.recommendedDoseMgPerKg;
    const min = resolved.minDoseMgPerKg;
    const max = resolved.maxDoseMgPerKg;
    if (std === undefined) return null;
    const doseUnit = doseUnitLabel(resolved.doseUnit);
    const unit = uiCase === "FULL" && min !== undefined && max !== undefined
      ? `${std.toFixed(3)} ${doseUnit}  (range ${min.toFixed(3)}–${max.toFixed(3)} ${doseUnit})`
      : `${std.toFixed(3)} ${doseUnit}`;
    return unit;
  })();

  // Compute deviation badge from calc
  const deviationBadge = (() => {
    if (calc.deviationPercent === null || !Number.isFinite(calc.deviationPercent)) return null;
    const abs = Math.abs(calc.deviationPercent);
    const sign = calc.deviationPercent >= 0 ? "+" : "-";
    const color = abs > 50
      ? "border-red-400 bg-red-100 text-red-800"
      : abs > 30
        ? "border-amber-400 bg-amber-100 text-amber-800"
        : "border-green-400 bg-green-100 text-green-800";
    return (
      <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm font-semibold ${color}`}>
        {sign}{abs.toFixed(1)}% from recommended{abs > 50 ? " - BLOCKED" : ""}
      </span>
    );
  })();

  return (
    <div className="mx-auto max-w-xl space-y-5 p-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground">Medication Calculator</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">Select a drug, enter the desired dose, then assign to a technician.</p>
        </div>
        {userCanManageFormulary ? (
          <button
            type="button"
            onClick={() => setShowFormularyManager((v) => !v)}
            className="flex items-center gap-1 rounded-lg border border-input px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/50"
          >
            Manage drugs
            {showFormularyManager ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        ) : null}
      </div>

      {showFormularyManager && userCanManageFormulary ? (
        <FormularyManager onClose={() => setShowFormularyManager(false)} />
      ) : null}

      {/* Technician */}
      <section aria-label="Performing technician" className="space-y-2">
        <label htmlFor="med-performing-technician" className="mb-1 block text-sm font-medium text-foreground">
          Performing Technician <span className="text-red-600">*</span>
        </label>
        <select
          id="med-performing-technician"
          value={selectedTechnicianId}
          onChange={(e) => setSelectedTechnicianId(e.target.value)}
          disabled={isTechnicianLoading || noTechniciansAvailable}
          className="w-full rounded-lg border border-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        >
          <option value="">
            {isTechnicianLoading ? "Loading technicians..." : "Select technician..."}
          </option>
          {technicians.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}{u.id === userId ? " (you)" : ""}
            </option>
          ))}
        </select>
        {technicianLoadError ? (
          <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {technicianLoadError}
            <button type="button" onClick={fetchTechnicians} className="ml-2 font-semibold underline">Retry</button>
          </div>
        ) : null}
        {noTechniciansAvailable && !technicianLoadError ? (
          <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            No eligible technicians found.
          </div>
        ) : null}
      </section>

      {/* Drug selection */}
      <section aria-label="Drug selection">
        <label htmlFor="drug-select" className="mb-1 block text-sm font-medium text-foreground">Drug</label>
        <select
          id="drug-select"
          value={selectedDrugName}
          onChange={(e) => setSelectedDrugName(e.target.value)}
          disabled={isSubmitting}
          className="w-full rounded-lg border border-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        >
          <option value="">- Select a drug -</option>
          {formularyList.map((entry) => (
            <option key={entry.id} value={entry.name}>
              {entry.name} ({concentrationDisplay(entry.name, entry.concentrationMgMl, entry.doseUnit)}{entry.defaultRoute ? ` · ${entry.defaultRoute}` : ""})
            </option>
          ))}
        </select>
        {selectedDrugName ? (() => {
          const sel = formularyList.find((e) => e.name === selectedDrugName);
          return sel?.defaultRoute ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Route: <span className="font-semibold">{sel.defaultRoute}</span>
              <span className="mx-1">•</span>
              Concentration: <span className="font-semibold">{concentrationDisplay(sel.name, sel.concentrationMgMl, sel.doseUnit)}</span>
            </p>
          ) : null;
        })() : null}
      </section>

      {selectedDrugName && resolved ? (
        <>
          {/* Dosage range reference */}
          {doseRangeText ? (
            <section aria-label="Dosage range">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Standard Dosage Range</p>
              <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm font-medium text-foreground">
                {doseRangeText}
              </div>
            </section>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
              No recommended dose in formulary. Enter dose manually.
            </div>
          )}

          {/* Patient weight (required) */}
          <section aria-label="Patient weight">
            <label htmlFor="weight-input" className="mb-1 block text-sm font-medium text-foreground">
              Patient Weight (kg) <span className="text-red-600">*</span>
            </label>
            <input
              id="weight-input"
              type="number" inputMode="decimal" min="0.01" step="0.1"
              value={weightKgRaw}
              onChange={(e) => setWeightKgRaw(e.target.value)}
              placeholder="e.g. 12.5"
              required
              disabled={isSubmitting}
              className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 ${
                weightKgRaw && !weightIsValid ? "border-red-400 bg-red-50" : "border-input"
              }`}
            />
            {!weightIsValid && weightKgRaw === "" ? (
              <p className="mt-1 text-xs text-red-600">Weight is required to create a medication task.</p>
            ) : null}
          </section>

          {/* Desired dose in mg */}
          <section aria-label="Desired dose">
            <label htmlFor="desired-mg-input" className="mb-1 block text-sm font-medium text-foreground">
              Desired Dose (mg) <span className="text-red-600">*</span>
            </label>
            <input
              id="desired-mg-input"
              type="number" inputMode="decimal" min="0.001" step="0.001"
              value={desiredMgRaw}
              onChange={(e) => setDesiredMgRaw(e.target.value)}
              placeholder="e.g. 25"
              disabled={isSubmitting}
              className="w-full rounded-lg border border-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
          </section>

          {deviationBadge}

          <BlockAlert reason={calc.blockReason} />

          {/* Volume result */}
          <section
            aria-live="polite"
            aria-label="Calculated volume"
            className={`rounded-2xl border-2 p-6 text-center transition-colors ${
              canExecute ? "border-primary/40 bg-primary/5" : "border-border bg-muted opacity-60"
            }`}
          >
            <p className="mb-1 text-sm font-medium uppercase tracking-wide text-muted-foreground">GIVE</p>
            <p className={`text-5xl font-black tracking-tight ${canExecute ? "text-primary" : "text-muted-foreground"}`}>
              {calc.isBlocked || !Number.isFinite(calc.volumeMl)
                ? "—"
                : resolved?.doseUnit === "tablet"
                  ? `${formatTabletFraction(calc.volumeMl)} tab`
                  : `${calc.volumeMl.toFixed(2)} mL`}
            </p>
            {!calc.isBlocked && Number.isFinite(calc.totalMg) && calc.totalMg > 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">= {calc.totalMg.toFixed(2)} mg total</p>
            ) : null}
          </section>

          {apiError ? (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
              <span aria-hidden className="text-lg leading-none">❌</span>
              <span>{apiError}</span>
            </div>
          ) : null}

          {successMessage ? (
            <div role="status" className="flex items-center gap-2 rounded-lg border border-green-300 bg-green-50 p-3 text-sm font-medium text-green-800">
              {successMessage}
            </div>
          ) : null}

          <div className={`flex gap-2 pt-1 ${onCancel ? "flex-row items-stretch justify-end" : ""}`}>
            {onCancel ? (
              <button
                type="button" onClick={onCancel}
                className="shrink-0 rounded-xl border border-input px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/50"
              >
                Back
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleGiveMedication}
              disabled={!canExecute || isSubmitting}
              aria-disabled={!canExecute || isSubmitting}
              className={`rounded-2xl py-4 text-lg font-bold tracking-wide transition-all duration-150 focus:outline-none focus-visible:ring-4 focus-visible:ring-ring ${
                onCancel ? "min-w-0 flex-1" : "w-full"
              } ${
                canExecute && !isSubmitting
                  ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary/90 active:scale-95"
                  : "cursor-not-allowed bg-muted text-muted-foreground shadow-none"
              }`}
            >
              {isSubmitting
                ? "Assigning..."
                : canExecute
                  ? resolved?.doseUnit === "tablet"
                    ? `Assign Medication — ${formatTabletFraction(calc.volumeMl)} tab`
                    : `Assign Medication — ${calc.volumeMl.toFixed(2)} mL`
                  : "Assign Medication"}
            </button>
          </div>

          {performerId ? (
            <p className="text-center text-xs text-muted-foreground">
              Task will be assigned to the selected technician and requires vet approval before administration.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
