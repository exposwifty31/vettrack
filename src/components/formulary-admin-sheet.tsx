// src/components/formulary-admin-sheet.tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { type DrugFormularyEntry, type CreateDrugFormularyRequest } from "@/types";
import { t } from "@/lib/i18n";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type DrugForm = {
  name: string;
  genericName: string;
  brandNames: string;       // comma-separated
  targetSpecies: string;    // comma-separated
  category: string;
  dosageNotes: string;
  concentrationMgMl: string;
  standardDose: string;
  minDose: string;
  maxDose: string;
  doseUnit: "mg_per_kg" | "mcg_per_kg" | "mEq_per_kg" | "tablet";
  defaultRoute: string;
  unitType: "vial" | "ampule" | "tablet" | "capsule" | "bag" | "";
  unitVolumeMl: string;
};

const BLANK_FORM: DrugForm = {
  name: "", genericName: "", brandNames: "", targetSpecies: "",
  category: "", dosageNotes: "", concentrationMgMl: "", standardDose: "",
  minDose: "", maxDose: "", doseUnit: "mg_per_kg", defaultRoute: "",
  unitType: "", unitVolumeMl: "",
};

function formToRequest(form: DrugForm): CreateDrugFormularyRequest {
  return {
    name: form.name.trim(),
    genericName: form.genericName.trim(),
    brandNames: form.brandNames ? form.brandNames.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    targetSpecies: form.targetSpecies ? form.targetSpecies.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    category: form.category.trim() || null,
    dosageNotes: form.dosageNotes.trim() || null,
    concentrationMgMl: parseFloat(form.concentrationMgMl),
    standardDose: parseFloat(form.standardDose),
    minDose: form.minDose ? parseFloat(form.minDose) : null,
    maxDose: form.maxDose ? parseFloat(form.maxDose) : null,
    doseUnit: form.doseUnit,
    defaultRoute: form.defaultRoute.trim() || null,
    unitType: (form.unitType || null) as CreateDrugFormularyRequest["unitType"],
    unitVolumeMl: form.unitVolumeMl ? parseFloat(form.unitVolumeMl) : null,
  };
}

function entryToForm(entry: DrugFormularyEntry): DrugForm {
  return {
    name: entry.name,
    genericName: entry.genericName,
    brandNames: (entry.brandNames ?? []).join(", "),
    targetSpecies: (entry.targetSpecies ?? []).join(", "),
    category: entry.category ?? "",
    dosageNotes: entry.dosageNotes ?? "",
    concentrationMgMl: String(entry.concentrationMgMl),
    standardDose: String(entry.standardDose),
    minDose: entry.minDose != null ? String(entry.minDose) : "",
    maxDose: entry.maxDose != null ? String(entry.maxDose) : "",
    doseUnit: entry.doseUnit,
    defaultRoute: entry.defaultRoute ?? "",
    unitType: entry.unitType ?? "",
    unitVolumeMl: entry.unitVolumeMl != null ? String(entry.unitVolumeMl) : "",
  };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FormularyAdminSheet({ open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<DrugFormularyEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DrugFormularyEntry | null>(null);
  const [form, setForm] = useState<DrugForm>(BLANK_FORM);

  const formularyQ = useQuery({
    queryKey: ["/api/formulary"],
    queryFn: () => api.formulary.list(),
    enabled: open,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const filtered = (formularyQ.data ?? []).filter(
    (d) =>
      !search ||
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.genericName.toLowerCase().includes(search.toLowerCase()),
  );

  const createMut = useMutation({
    mutationFn: () => api.formulary.upsert(formToRequest(form)),
    onSuccess: () => {
      toast.success(t.admin.formulary.toast.added);
      qc.invalidateQueries({ queryKey: ["/api/formulary"] });
      setFormOpen(false);
    },
    onError: () => toast.error(t.admin.formulary.toast.addFailed),
  });

  const updateMut = useMutation({
    mutationFn: () => api.formulary.update(editTarget!.id, formToRequest(form)),
    onSuccess: () => {
      toast.success(t.admin.formulary.toast.updated);
      qc.invalidateQueries({ queryKey: ["/api/formulary"] });
      setFormOpen(false);
    },
    onError: () => toast.error(t.admin.formulary.toast.updateFailed),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.formulary.remove(id),
    onSuccess: () => {
      toast.success(t.admin.formulary.toast.removed);
      qc.invalidateQueries({ queryKey: ["/api/formulary"] });
      setDeleteTarget(null);
    },
    onError: () => toast.error(t.admin.formulary.toast.removeFailed),
  });

  function openCreate() {
    setEditTarget(null);
    setForm(BLANK_FORM);
    setFormOpen(true);
  }

  function openEdit(entry: DrugFormularyEntry) {
    setEditTarget(entry);
    setForm(entryToForm(entry));
    setFormOpen(true);
  }

  function handleSave() {
    if (editTarget) updateMut.mutate();
    else createMut.mutate();
  }

  const isPending = editTarget ? updateMut.isPending : createMut.isPending;
  const isFormValid =
    form.name.trim() !== "" &&
    form.genericName.trim() !== "" &&
    parseFloat(form.concentrationMgMl) > 0 &&
    parseFloat(form.standardDose) > 0;

  function f(key: keyof DrugForm) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }));
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col p-0">
          <SheetHeader className="px-4 pt-5 pb-3 border-b">
            <div className="flex items-center justify-between">
              <SheetTitle>{t.admin.formulary.title}</SheetTitle>
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4 mr-1" />
                {t.admin.formulary.addDrug}
              </Button>
            </div>
            <div className="relative mt-2">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t.admin.formulary.searchPlaceholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="ps-9"
              />
            </div>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto divide-y">
            {formularyQ.isPending ? (
              <p className="text-sm text-muted-foreground p-4">{t.admin.formulary.loading}</p>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground p-4 text-center">{t.admin.formulary.emptyMessage}</p>
            ) : (
              filtered.map((entry) => (
                <div key={entry.id} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/30">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{entry.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {entry.genericName} · {entry.concentrationMgMl} mg/ml · {entry.standardDose} {entry.doseUnit.replace(/_/g, " ")}
                    </p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => openEdit(entry)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(entry)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Create / Edit dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto max-w-lg">
          <DialogHeader>
            <DialogTitle>{editTarget ? t.admin.formulary.editTitle : t.admin.formulary.newTitle}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{t.admin.formulary.fieldName}</Label>
                <Input value={form.name} onChange={f("name")} placeholder="Propofol" />
              </div>
              <div className="space-y-1">
                <Label>{t.admin.formulary.fieldGenericName}</Label>
                <Input value={form.genericName} onChange={f("genericName")} placeholder="Propofol" />
              </div>
            </div>
            <div className="space-y-1">
              <Label>{t.admin.formulary.fieldBrandNames}</Label>
              <Input value={form.brandNames} onChange={f("brandNames")} placeholder="Diprivan, Fresofol" />
            </div>
            <div className="space-y-1">
              <Label>{t.admin.formulary.fieldSpecies}</Label>
              <Input value={form.targetSpecies} onChange={f("targetSpecies")} placeholder="dog, cat" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{t.admin.formulary.fieldCategory}</Label>
                <Input value={form.category} onChange={f("category")} placeholder="Anesthetic" />
              </div>
              <div className="space-y-1">
                <Label>{t.admin.formulary.fieldRoute}</Label>
                <Input value={form.defaultRoute} onChange={f("defaultRoute")} placeholder="IV" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{t.admin.formulary.fieldConcentration}</Label>
                <Input type="number" min={0.001} step="any" value={form.concentrationMgMl} onChange={f("concentrationMgMl")} placeholder="10" />
              </div>
              <div className="space-y-1">
                <Label>{t.admin.formulary.fieldStandardDose}</Label>
                <Input type="number" min={0.001} step="any" value={form.standardDose} onChange={f("standardDose")} placeholder="6" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label>{t.admin.formulary.fieldMinDose}</Label>
                <Input type="number" min={0} step="any" value={form.minDose} onChange={f("minDose")} placeholder="4" />
              </div>
              <div className="space-y-1">
                <Label>{t.admin.formulary.fieldMaxDose}</Label>
                <Input type="number" min={0} step="any" value={form.maxDose} onChange={f("maxDose")} placeholder="8" />
              </div>
              <div className="space-y-1">
                <Label>{t.admin.formulary.fieldDoseUnit}</Label>
                <Select
                  value={form.doseUnit}
                  onValueChange={(v) => setForm((prev) => ({ ...prev, doseUnit: v as DrugForm["doseUnit"] }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mg_per_kg">mg/kg</SelectItem>
                    <SelectItem value="mcg_per_kg">mcg/kg</SelectItem>
                    <SelectItem value="mEq_per_kg">mEq/kg</SelectItem>
                    <SelectItem value="tablet">tablet</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{t.admin.formulary.fieldUnitType}</Label>
                <Select
                  value={form.unitType || "__none__"}
                  onValueChange={(v) => setForm((prev) => ({ ...prev, unitType: v === "__none__" ? "" : v as DrugForm["unitType"] }))}
                >
                  <SelectTrigger><SelectValue placeholder={t.admin.formulary.noneOption} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t.admin.formulary.noneOption}</SelectItem>
                    <SelectItem value="vial">Vial</SelectItem>
                    <SelectItem value="ampule">Ampule</SelectItem>
                    <SelectItem value="tablet">Tablet</SelectItem>
                    <SelectItem value="capsule">Capsule</SelectItem>
                    <SelectItem value="bag">Bag</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{t.admin.formulary.fieldUnitVolume}</Label>
                <Input type="number" min={0} step="any" value={form.unitVolumeMl} onChange={f("unitVolumeMl")} placeholder="20" />
              </div>
            </div>
            <div className="space-y-1">
              <Label>{t.admin.formulary.fieldDosageNotes}</Label>
              <Textarea value={form.dosageNotes} onChange={f("dosageNotes")} placeholder={t.admin.formulary.dosageNotesPlaceholder} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>{t.common.cancel}</Button>
            <Button onClick={handleSave} disabled={isPending || !isFormValid}>
              {isPending ? t.admin.formulary.saving : t.admin.formulary.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.admin.formulary.removeConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.admin.formulary.removeConfirmDesc(deleteTarget?.name ?? "")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t.admin.formulary.removeAction}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
