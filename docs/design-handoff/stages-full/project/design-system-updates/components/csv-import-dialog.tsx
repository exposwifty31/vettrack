// src/components/csv-import-dialog.tsx
// Design System Alignment — §34-D3 / §37-D2 resolved (Phase 19, §38):
// this file was one of the 3 named "standard alert box" holdouts (inline
// banners / validation / CSV errors). Two distinct issues, both fixed:
//   1. Every success/error indicator here used hardcoded Tailwind
//      emerald-*/red-* utilities instead of the app's own real
//      --status-ok-*/--status-issue-* tokens — invisible in a review of
//      "does it look boxy," only visible by reading the actual classes.
//   2. The "done" success banner was a full 4-side border box (same
//      pattern as the AlertCard/ErrorCard fixes in Phase 15) — now a rail.
// Everything else in this file (CSV parsing, step state machine, table
// layout) is byte-for-byte unchanged from the real source.
import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Upload, Download, AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react";
import { t } from "@/lib/i18n";

const CSV_TEMPLATE =
  "name,serial,status,location,folder,maintenanceIntervalDays,notes\n" +
  "Autoclave Unit A,SN-001,ok,Surgery Room 1,,30,Annual calibration required\n" +
  "Defibrillator B,SN-002,ok,ICU,Cardiac,,";

interface ParsedRow {
  rowNum: number;
  name: string;
  serial: string;
  status: string;
  location: string;
  folder: string;
  maintenanceIntervalDays: string;
  notes: string;
  error?: string;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(field.trim());
      field = "";
    } else {
      field += ch;
    }
  }
  fields.push(field.trim());
  return fields;
}

function normalizeHeader(h: string): string {
  return h
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/^["']|["']$/g, "")
    .replace(/[\s_-]+/g, "")
    .replace(/[()[\]./\\]/g, "");
}

function previewParse(csv: string): ParsedRow[] {
  const lines = csv.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length < 2) return [];
  const [headerLine, ...dataLines] = nonEmpty;
  const headers = parseCsvLine(headerLine).map(normalizeHeader);

  const idx = {
    name: headers.indexOf("name"),
    serial: headers.indexOf("serial"),
    status: headers.indexOf("status"),
    location: headers.indexOf("location"),
    folder: headers.indexOf("folder"),
    maint: headers.indexOf("maintenanceintervaldays"),
    notes: headers.indexOf("notes"),
  };

  const VALID_STATUSES = new Set(["ok", "issue", "maintenance", "sterilized", ""]);

  return dataLines.slice(0, 100).map((line, i) => {
    const cols = parseCsvLine(line);
    const get = (idxVal: number) => (idxVal >= 0 ? (cols[idxVal] ?? "").trim() : "");

    const name = get(idx.name);
    const serial = get(idx.serial);
    const status = get(idx.status) || "ok";
    const location = get(idx.location);
    const folder = get(idx.folder);
    const maintenanceIntervalDays = get(idx.maint);
    const notes = get(idx.notes);

    let error: string | undefined;
    if (!name) {
      error = "Name is required";
    } else if (!VALID_STATUSES.has(status.toLowerCase())) {
      error = `Invalid status "${status}"`;
    } else if (maintenanceIntervalDays && (isNaN(parseInt(maintenanceIntervalDays, 10)) || parseInt(maintenanceIntervalDays, 10) < 1)) {
      error = `Invalid maintenanceIntervalDays "${maintenanceIntervalDays}"`;
    }

    return { rowNum: i + 2, name, serial, status, location, folder, maintenanceIntervalDays, notes, error };
  });
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = "upload" | "preview" | "importing" | "done";

export function CsvImportDialog({ open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [csvText, setCsvText] = useState("");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ParsedRow[]>([]);
  const [result, setResult] = useState<{ inserted: number; skipped: Array<{ row: number; reason: string }> } | null>(null);

  function handleClose() {
    if (step === "importing") return;
    onOpenChange(false);
    setTimeout(() => {
      setStep("upload");
      setCsvText("");
      setCsvFile(null);
      setFileName("");
      setPreview([]);
      setResult(null);
    }, 200);
  }

  function downloadTemplate() {
    const blob = new Blob([CSV_TEMPLATE], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vettrack-equipment-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    if (!file.name.endsWith(".csv") && file.type !== "text/csv" && file.type !== "text/plain") {
      toast.error(t.admin.csvImport.toast.pleaseUploadCsv);
      return;
    }

    setCsvFile(file);
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = (evt.target?.result as string) ?? "";
      setCsvText(text);
      setFileName(file.name);
      const parsed = previewParse(text);
      setPreview(parsed);
      setStep("preview");
    };
    reader.readAsText(file);
  }

  const importMut = useMutation({
    mutationFn: () => {
      if (!csvFile) throw new Error("No file selected");
      return api.equipment.importCsv(csvFile);
    },
    onMutate: () => setStep("importing"),
    onSuccess: (data) => {
      setResult(data);
      setStep("done");
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      toast.success(`${data.inserted} item${data.inserted !== 1 ? "s" : ""} imported`);
    },
    onError: (err: Error) => {
      setStep("preview");
      toast.error(err.message || "Import failed");
    },
  });

  const validRows = preview.filter((r) => !r.error);
  const errorRows = preview.filter((r) => r.error);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Equipment from CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV file to bulk-register equipment. Valid rows will be imported; invalid rows will be skipped with an error report.
          </DialogDescription>
        </DialogHeader>

        {/* Upload step */}
        {step === "upload" && (
          <div className="flex flex-col gap-4">
            <div
              className="border-2 border-dashed border-border rounded-xl p-8 flex flex-col items-center gap-3 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="w-10 h-10 text-muted-foreground" />
              <div>
                <p className="font-medium">Click to upload a CSV file</p>
                <p className="text-sm text-muted-foreground mt-1">Max 500 rows. Must include a "name" column.</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv,text/plain"
                className="hidden"
                onChange={handleFileChange}
                data-testid="csv-file-input"
              />
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
              <div>
                <p className="text-sm font-medium">Need a template?</p>
                <p className="text-xs text-muted-foreground">Download the CSV template with the correct column headers.</p>
              </div>
              <Button variant="outline" size="sm" onClick={downloadTemplate} data-testid="btn-download-template">
                <Download className="w-4 h-4 me-1.5" />
                Template
              </Button>
            </div>
          </div>
        )}

        {/* Preview step */}
        {(step === "preview" || step === "importing") && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{fileName}</span> — {preview.length} data row{preview.length !== 1 ? "s" : ""}
              </p>
              {step === "preview" && (
                <Button variant="ghost" size="sm" onClick={() => { setStep("upload"); setCsvText(""); setPreview([]); setFileName(""); }}>
                  <X className="w-4 h-4 me-1" />
                  Change file
                </Button>
              )}
            </div>

            {/* Summary chips — real status-ok / status-issue tokens, not hardcoded emerald/red */}
            <div className="flex gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[var(--status-ok-bg)] text-[var(--status-ok-fg)] text-xs font-medium border border-[var(--status-ok-border)]">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {validRows.length} valid
              </span>
              {errorRows.length > 0 && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[var(--status-issue-bg)] text-[var(--status-issue-fg)] text-xs font-medium border border-[var(--status-issue-border)]">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {errorRows.length} will be skipped
                </span>
              )}
            </div>

            {/* Preview table */}
            <div className="overflow-x-auto rounded-lg border border-border text-xs">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="px-2 py-2 text-start font-medium text-muted-foreground w-8">#</th>
                    <th className="px-2 py-2 text-start font-medium text-muted-foreground">Name</th>
                    <th className="px-2 py-2 text-start font-medium text-muted-foreground">Serial</th>
                    <th className="px-2 py-2 text-start font-medium text-muted-foreground">Status</th>
                    <th className="px-2 py-2 text-start font-medium text-muted-foreground">Location</th>
                    <th className="px-2 py-2 text-start font-medium text-muted-foreground min-w-32">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row) => (
                    <tr
                      key={row.rowNum}
                      className={row.error ? "bg-[var(--status-issue-bg)]" : "hover:bg-muted/30"}
                    >
                      <td className="px-2 py-1.5 text-muted-foreground">{row.rowNum}</td>
                      <td className="px-2 py-1.5 font-medium truncate max-w-[140px]" title={row.name || undefined}>{row.name || <span className="text-muted-foreground italic">empty</span>}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{row.serial}</td>
                      <td className="px-2 py-1.5">{row.status}</td>
                      <td className="px-2 py-1.5 text-muted-foreground truncate max-w-[100px]" title={row.location || undefined}>{row.location}</td>
                      <td className="px-2 py-1.5 text-[var(--status-issue-fg)]">{row.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.length >= 100 && (
              <p className="text-xs text-muted-foreground">Preview shows first 100 rows. All rows in the file will be processed on import.</p>
            )}
          </div>
        )}

        {/* Done step */}
        {step === "done" && result && (
          <div className="flex flex-col gap-4">
            {/* Was a full 4-side border box (bg-emerald-50 border border-emerald-200) —
                now a rail, same language as AlertCard/ErrorCard/Card's criticality
                system, and real --status-ok-* tokens instead of hardcoded emerald. */}
            <div className="flex items-center gap-3 rounded-xl bg-[var(--status-ok-bg)] border-s-4 border-s-[var(--status-ok-border)] p-4">
              <CheckCircle2 className="w-8 h-8 text-[var(--status-ok-fg)] shrink-0" />
              <div>
                <p className="font-semibold text-[var(--status-ok-fg)]">{result.inserted} item{result.inserted !== 1 ? "s" : ""} imported successfully</p>
                {result.skipped.length > 0 && (
                  <p className="text-sm text-[var(--status-ok-fg)] mt-0.5">{result.skipped.length} row{result.skipped.length !== 1 ? "s" : ""} skipped</p>
                )}
              </div>
            </div>
            {result.skipped.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium">Skipped rows</p>
                <div className="overflow-x-auto rounded-lg border border-border text-xs max-h-48 overflow-y-auto">
                  <table className="w-full">
                    <thead className="sticky top-0">
                      <tr className="bg-muted/50">
                        <th className="px-2 py-2 text-start font-medium text-muted-foreground w-8">Row</th>
                        <th className="px-2 py-2 text-start font-medium text-muted-foreground">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.skipped.map((s) => (
                        <tr key={s.row} className="bg-[var(--status-issue-bg)]">
                          <td className="px-2 py-1.5">{s.row}</td>
                          <td className="px-2 py-1.5 text-[var(--status-issue-fg)]">{s.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="mt-2">
          {step === "upload" && (
            <Button variant="outline" onClick={handleClose}>Cancel</Button>
          )}
          {step === "preview" && (
            <>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button
                onClick={() => importMut.mutate()}
                disabled={validRows.length === 0}
                data-testid="btn-confirm-import"
              >
                Import {validRows.length} row{validRows.length !== 1 ? "s" : ""}
              </Button>
            </>
          )}
          {step === "importing" && (
            <Button disabled>
              <Loader2 className="w-4 h-4 me-2 animate-spin" />
              Importing…
            </Button>
          )}
          {step === "done" && (
            <Button onClick={handleClose}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
