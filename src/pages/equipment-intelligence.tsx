import { useState } from "react";
import { Helmet } from "react-helmet-async";
import { useMutation } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { PageErrorBoundary } from "@/components/ui/page-error-boundary";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import { toast } from "sonner";
import type { IntelligenceRecommendation } from "@/types/equipment-intelligence";
import { INSUFFICIENT_EVIDENCE_MESSAGE } from "@/types/equipment-intelligence";
import { Brain, ClipboardList, Loader2, ShieldAlert } from "lucide-react";
import { isPilotMode } from "@/lib/pilot-mode";

function severityVariant(severity: string): "destructive" | "default" | "secondary" | "outline" {
  if (severity === "critical" || severity === "high") return "destructive";
  if (severity === "medium") return "default";
  return "secondary";
}

function RiskCard({
  risk,
  evidenceLabels,
  onCreateTask,
  creatingId,
  pilotMode,
}: {
  risk: IntelligenceRecommendation;
  evidenceLabels: Map<string, string>;
  onCreateTask: (id: string) => void;
  creatingId: string | null;
  pilotMode: boolean;
}) {
  return (
    <Card className="border-border/80">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="text-base font-semibold leading-snug">{risk.finding}</CardTitle>
          <div className="flex flex-wrap gap-1">
            <Badge variant={severityVariant(risk.severity)}>{risk.severity}</Badge>
            <Badge variant="outline">{risk.confidence}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div>
          <p className="font-medium text-muted-foreground">{t.equipmentIntelligence.impact}</p>
          <p>{risk.impact}</p>
        </div>
        <div>
          <p className="font-medium text-muted-foreground">{t.equipmentIntelligence.evidence}</p>
          <ul className="list-disc ps-5 space-y-1">
            {risk.evidence.map((id) => (
              <li key={id}>{evidenceLabels.get(id) ?? id}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="font-medium text-muted-foreground">{t.equipmentIntelligence.recommendedAction}</p>
          <p>{risk.recommendedAction}</p>
        </div>
        {!pilotMode && (
          <Button
            size="sm"
            variant="secondary"
            disabled={creatingId === risk.id}
            onClick={() => onCreateTask(risk.id)}
          >
            {creatingId === risk.id ? (
              <Loader2 className="w-4 h-4 animate-spin me-2" />
            ) : null}
            {t.equipmentIntelligence.createTask}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export default function EquipmentIntelligencePage() {
  const [analysis, setAnalysis] = useState<Awaited<ReturnType<typeof api.equipmentIntelligence.analyze>> | null>(
    null,
  );
  const [shiftReport, setShiftReport] = useState<
    Awaited<ReturnType<typeof api.equipmentIntelligence.shiftHandover>> | null
  >(null);
  const [confirmRecId, setConfirmRecId] = useState<string | null>(null);
  const [creatingId, setCreatingId] = useState<string | null>(null);

  const analyzeMutation = useMutation({
    mutationFn: () => api.equipmentIntelligence.analyze(),
    onSuccess: (data) => {
      setAnalysis(data);
      setShiftReport(null);
      toast.success(t.equipmentIntelligence.analyzeDone);
    },
    onError: () => toast.error(t.equipmentIntelligence.analyzeFailed),
  });

  const shiftMutation = useMutation({
    mutationFn: () => api.equipmentIntelligence.shiftHandover(),
    onSuccess: (data) => {
      setShiftReport(data);
      toast.success(t.equipmentIntelligence.shiftDone);
    },
    onError: () => toast.error(t.equipmentIntelligence.shiftFailed),
  });

  const evidenceLabels = new Map<string, string>();
  const graph = analysis?.evidence ?? shiftReport?.evidence;
  if (graph) {
    for (const node of graph.nodes) {
      evidenceLabels.set(node.id, node.label);
    }
  }

  const handleCreateTask = async (recommendationId: string) => {
    setCreatingId(recommendationId);
    try {
      const result = await api.equipmentIntelligence.createTaskFromRecommendation(recommendationId, {
        confirmed: true,
      });
      toast.success(t.equipmentIntelligence.taskCreated(result.taskId));
      setConfirmRecId(null);
    } catch {
      toast.error(t.equipmentIntelligence.taskFailed);
    } finally {
      setCreatingId(null);
    }
  };

  const topRisks = analysis?.topRisks ?? [];
  const insufficient =
    analysis?.insufficientEvidence &&
    analysis.executiveSummary === INSUFFICIENT_EVIDENCE_MESSAGE;

  return (
    <Layout>
      <Helmet>
        <title>{t.equipmentIntelligence.pageTitle}</title>
      </Helmet>
      <PageErrorBoundary fallbackLabel={t.equipmentIntelligence.pageTitle}>
        <div className="max-w-3xl mx-auto p-4 space-y-6">
          <div className="flex items-center gap-3">
            <Brain className="w-8 h-8 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">{t.equipmentIntelligence.pageTitle}</h1>
              <p className="text-muted-foreground text-sm">{t.equipmentIntelligence.subtitle}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => analyzeMutation.mutate()}
              disabled={analyzeMutation.isPending}
            >
              {analyzeMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin me-2" />
              ) : (
                <ShieldAlert className="w-4 h-4 me-2" />
              )}
              {t.equipmentIntelligence.analyzeButton}
            </Button>
            <Button
              variant="outline"
              onClick={() => shiftMutation.mutate()}
              disabled={shiftMutation.isPending}
            >
              {shiftMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin me-2" />
              ) : (
                <ClipboardList className="w-4 h-4 me-2" />
              )}
              {t.equipmentIntelligence.shiftButton}
            </Button>
          </div>

          {analysis && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t.equipmentIntelligence.executiveSummary}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm leading-relaxed">{analysis.executiveSummary}</p>
                {insufficient ? (
                  <p className="text-sm text-amber-600 dark:text-amber-400 font-medium">
                    {INSUFFICIENT_EVIDENCE_MESSAGE}
                  </p>
                ) : (
                  <>
                    <h2 className="font-semibold">{t.equipmentIntelligence.topRisks}</h2>
                    <div className="space-y-3">
                      {topRisks.map((risk) => (
                        <RiskCard
                          key={risk.id}
                          risk={risk}
                          evidenceLabels={evidenceLabels}
                          pilotMode={isPilotMode}
                          creatingId={creatingId}
                          onCreateTask={(id) => setConfirmRecId(id)}
                        />
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {shiftReport && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t.equipmentIntelligence.shiftTitle}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <p>{shiftReport.executiveSummary}</p>
                {shiftReport.insufficientEvidence ? (
                  <p className="text-amber-600 dark:text-amber-400 font-medium">
                    {INSUFFICIENT_EVIDENCE_MESSAGE}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {shiftReport.criticalIssues.map((r) => (
                      <RiskCard
                        key={r.id}
                        risk={r}
                        evidenceLabels={evidenceLabels}
                        pilotMode={isPilotMode}
                        creatingId={creatingId}
                        onCreateTask={(id) => setConfirmRecId(id)}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <AlertDialog open={confirmRecId !== null} onOpenChange={(open) => !open && setConfirmRecId(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t.equipmentIntelligence.confirmTitle}</AlertDialogTitle>
                <AlertDialogDescription>{t.equipmentIntelligence.confirmDesc}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t.equipmentIntelligence.cancel}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => confirmRecId && void handleCreateTask(confirmRecId)}
                >
                  {t.equipmentIntelligence.confirmCreate}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </PageErrorBoundary>
    </Layout>
  );
}
