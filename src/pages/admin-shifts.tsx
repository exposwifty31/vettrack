import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, CheckCircle2, AlertTriangle, History } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorCard } from "@/components/ui/error-card";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { t } from "@/lib/i18n";
import type { ShiftImportPreview } from "@/types";

export default function AdminShiftsPage() {
  const { isAdmin, userId } = useAuth();
  const queryClient = useQueryClient();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ShiftImportPreview | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /** Shared file intake for both the file picker and drag-and-drop. */
  function acceptCsvFile(file: File | null | undefined): void {
    if (file && !file.name.toLowerCase().endsWith(".csv")) {
      toast.error(t.adminShiftsPage.csvOnly);
      setSelectedFile(null);
      setPreview(null);
      return;
    }
    setSelectedFile(file ?? null);
    setPreview(null);
  }

  const importsQuery = useQuery({
    retry: false,
    refetchOnWindowFocus: false,
    queryKey: ["/api/shifts/imports"],
    queryFn: api.shifts.imports,
    enabled: isAdmin && !!userId,
  });

  const previewMut = useMutation({
    mutationFn: (file: File) => api.shifts.previewImport(file),
    onSuccess: (data) => {
      setPreview(data);
      toast.success(t.adminShiftsPage.previewReady);
    },
    onError: (error: Error) => {
      setPreview(null);
      toast.error(error.message || t.adminShiftsPage.previewFailed);
    },
  });

  const confirmMut = useMutation({
    mutationFn: (file: File) => api.shifts.confirmImport(file),
    onSuccess: (result) => {
      if (result.skippedRows > 0) {
        toast.warning(t.adminShiftsPage.importSuccessWithSkipped(result.insertedRows, result.skippedRows));
      } else {
        toast.success(t.adminShiftsPage.importSuccess);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/shifts/imports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      // Keep selected file + preview visible after confirm so admins can
      // still see exactly which CSV/rows were imported.
      if (import.meta.env.DEV) {
        console.log(
          `[admin shifts] confirmed import filename=${result.filename} inserted=${result.insertedRows} skipped=${result.skippedRows}`
        );
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || t.adminShiftsPage.importFailed);
    },
  });

  const canPreview = Boolean(selectedFile) && !previewMut.isPending;
  const canImport = Boolean(selectedFile) && Boolean(preview && preview.summary.validRows > 0) && !confirmMut.isPending;

  const sortedPreviewRows = useMemo(() => {
    if (!preview) return [];
    return [...preview.rows].sort((a, b) => a.rowNumber - b.rowNumber);
  }, [preview]);

  if (!isAdmin) {
    return (
      <AppShell title={t.adminShiftsPage.title}>
        <div className="py-10 text-center text-sm text-muted-foreground">{t.adminPage.cancel}</div>
      </AppShell>
    );
  }

  return (
    <AppShell title={t.adminShiftsPage.title}>
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-4 pb-24 pt-3 animate-fade-in sm:px-6 lg:max-w-[1120px]">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t.adminShiftsPage.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t.adminShiftsPage.subtitle}</p>
        </div>

        <Card className="bg-card border-border/60 shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Upload className="w-4 h-4 text-muted-foreground" />
              {t.adminShiftsPage.uploadCsv}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(event) => {
                acceptCsvFile(event.target.files?.[0] ?? null);
                event.currentTarget.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                acceptCsvFile(event.dataTransfer.files?.[0]);
              }}
              className="flex items-center gap-3 rounded-xl border-2 border-dashed border-border p-4 text-start transition-colors hover:border-primary/60 hover:bg-muted/40"
              data-testid="dropzone-shifts-csv"
            >
              <Upload className="w-5 h-5 shrink-0 text-primary" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{t.adminShiftsPage.uploadCsv}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {selectedFile ? selectedFile.name : t.adminShiftsPage.noFileSelected}
                </p>
              </div>
            </button>
            <div className="flex gap-2">
              <Button
                size="sm"
                className="h-11 text-xs"
                disabled={!canPreview}
                onClick={() => {
                  if (selectedFile) previewMut.mutate(selectedFile);
                }}
              >
                {t.adminShiftsPage.previewButton}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-11 text-xs"
                disabled={!canImport}
                onClick={() => {
                  if (selectedFile) confirmMut.mutate(selectedFile);
                }}
              >
                {confirmMut.isPending ? t.adminShiftsPage.confirmImporting : t.adminShiftsPage.confirmImportButton}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-11 text-xs"
                disabled={!selectedFile && !preview}
                onClick={() => {
                  setSelectedFile(null);
                  setPreview(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                data-testid="btn-clear-shifts-upload"
              >
                {t.adminShiftsPage.clearUpload}
              </Button>
            </div>
          </CardContent>
        </Card>

        {preview && (
          <Card className="bg-card border-border/60 shadow-sm">
            <CardHeader>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-muted-foreground" />
                {t.adminShiftsPage.previewSummaryTitle}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-lg border p-2">
                  <div className="text-muted-foreground">{t.adminShiftsPage.totalRows}</div>
                  <div className="text-lg font-bold [font-family:var(--font-num)]">{preview.summary.totalRows}</div>
                </div>
                <div className="rounded-lg border p-2">
                  <div className="text-muted-foreground">{t.adminShiftsPage.validRows}</div>
                  <div className="text-lg font-bold [font-family:var(--font-num)] text-[var(--status-ok-fg)]">{preview.summary.validRows}</div>
                </div>
                <div className="rounded-lg border p-2">
                  <div className="text-muted-foreground">{t.adminShiftsPage.skippedRows}</div>
                  <div className="text-lg font-bold [font-family:var(--font-num)] text-[var(--status-stale-fg)]">{preview.summary.skippedRows}</div>
                </div>
              </div>

              <div className="overflow-auto rounded-xl border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/60">
                    <tr>
                      <th className="text-start p-2">#</th>
                      <th className="text-start p-2">{t.adminShiftsPage.date}</th>
                      <th className="text-start p-2">{t.adminShiftsPage.startTime}</th>
                      <th className="text-start p-2">{t.adminShiftsPage.endTime}</th>
                      <th className="text-start p-2">{t.adminShiftsPage.employeeName}</th>
                      <th className="text-start p-2">{t.adminShiftsPage.role}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPreviewRows.map((row) => (
                      <tr key={`preview-${row.rowNumber}`} className="border-t border-border hover:bg-muted/50 transition-colors">
                        <td className="p-2">{row.rowNumber}</td>
                        <td className="p-2">{row.date}</td>
                        <td className="p-2">{row.startTime}</td>
                        <td className="p-2">{row.endTime}</td>
                        <td className="p-2">{row.employeeName}</td>
                        <td className="p-2">
                          {row.role === "senior_technician"
                            ? t.adminPage.roleSeniorTechnician
                            : row.role === "admin"
                            ? t.adminPage.roleAdminShift
                            : t.adminPage.roleTechnician}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {preview.issues.length > 0 && (
                <div className="rounded-xl border border-[var(--status-stale-border)] bg-[var(--status-stale-bg)] p-3 text-foreground">
                  <div className="flex items-center gap-1 text-xs font-semibold text-foreground">
                    <AlertTriangle className="w-4 h-4" />
                    {t.adminShiftsPage.issuesTitle}
                  </div>
                  <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {preview.issues.slice(0, 50).map((issue) => (
                      <li key={`issue-${issue.rowNumber}-${issue.reason}`}>
                        {t.adminShiftsPage.rowLabel(issue.rowNumber)}: {issue.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card className="bg-card border-border/60 shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <History className="w-4 h-4 text-muted-foreground" />
              {t.adminShiftsPage.importsHistoryTitle}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {importsQuery.isLoading ? (
              <div className="space-y-2" role="status" aria-live="polite" aria-busy="true">
                <span className="sr-only">{t.common.loading}</span>
                {[1, 2, 3].map((idx) => (
                  <Skeleton key={idx} className="h-10 rounded-lg" />
                ))}
              </div>
            ) : importsQuery.isError ? (
              <ErrorCard
                message={t.adminShiftsPage.importHistoryLoadFailed}
                onRetry={() => importsQuery.refetch()}
              />
            ) : !importsQuery.data || importsQuery.data.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t.adminShiftsPage.noImportsYet}</p>
            ) : (
              <div className="space-y-2">
                {importsQuery.data.map((entry) => (
                  <div key={entry.id} className="rounded-lg border border-border p-2 text-xs hover:bg-muted/50 transition-colors">
                    <div className="font-medium">{entry.filename}</div>
                    <div className="text-muted-foreground">
                      {new Date(entry.importedAt).toLocaleString()} · {entry.rowCount} {t.adminShiftsPage.rowCount}
                    </div>
                    <div className="text-muted-foreground">
                      {entry.importedByName || entry.importedByEmail || t.common.unknown}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
