import { t } from "@/lib/i18n";
import { isLeader, leaderPoll } from "@/lib/leader";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Helmet } from "react-helmet-async";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { authFetch } from "@/lib/auth-fetch";
import { Link } from "wouter";
import {
  ShieldCheck,
  Play,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  SkipForward,
  Activity,
  Zap,
  Server,
  Search,
  Trash2,
  FlaskConical,
  RefreshCw,
  CalendarClock,
  ToggleLeft,
  ToggleRight, FileText,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { toast } from "sonner";
import { jsPDF } from "jspdf";

const API = "/api/stability";

async function fetchStatus() {
  const res = await authFetch(`${API}/status`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function fetchResults() {
  const res = await authFetch(`${API}/results`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function fetchLogs(limit: number, search: string) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (search) params.set("search", search);
  const res = await authFetch(`${API}/logs?${params}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

type TestStatus = "pass" | "fail" | "warn" | "skip";
type Suite = "functional" | "stress" | "edge";

interface TestResult {
  id: string;
  suite: Suite;
  name: string;
  status: TestStatus;
  durationMs: number;
  expected?: string;
  actual?: string;
  detail?: string;
}

interface TestReport {
  runId: string;
  startedAt: string;
  finishedAt: string | null;
  status: "idle" | "running" | "done" | "error";
  results: TestResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    warned: number;
    skipped: number;
    avgLatencyMs: number;
    maxLatencyMs: number;
  };
}

interface StabilityStatus {
  running: boolean;
  testModeEnabled: boolean;
  scheduleHours: number;
  lastRun: TestReport | null;
}

interface LogEntry {
  id: string;
  timestamp: string;
  level: "info" | "success" | "warn" | "error";
  category: string;
  action: string;
  detail?: string;
  durationMs?: number;
}

function statusBadge(s: TestStatus) {
  const cfg: Record<TestStatus, { label: string; className: string; icon: React.ReactNode }> = {
    pass: { label: "PASS", className: "bg-status-ok/10 text-status-ok", icon: <CheckCircle2 className="w-3 h-3" /> },
    fail: { label: "FAIL", className: "bg-destructive/10 text-destructive", icon: <XCircle className="w-3 h-3" /> },
    warn: { label: "WARN", className: "bg-amber-500/10 text-amber-800 dark:text-amber-300", icon: <AlertTriangle className="w-3 h-3" /> },
    skip: { label: "SKIP", className: "bg-muted text-muted-foreground", icon: <SkipForward className="w-3 h-3" /> },
  };
  const c = cfg[s];
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-semibold", c.className)}>
      {c.icon}{c.label}
    </span>
  );
}

function logLevelColor(level: LogEntry["level"]) {
  return {
    info: "text-primary",
    success: "text-status-ok",
    warn: "text-amber-600 dark:text-amber-400",
    error: "text-destructive",
  }[level];
}

function suiteLabel(s: Suite) {
  return {
    functional: { label: "פונקציונלי", className: "bg-primary/10 text-primary" },
    stress: { label: "עומס", className: "bg-secondary text-secondary-foreground" },
    edge: { label: "מקרי קצה", className: "bg-muted/80 text-foreground" },
  }[s];
}

function SystemStatusBadge({ status, running }: { status: TestReport | null; running: boolean }) {
  if (running) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary font-semibold text-sm">
        <RefreshCw className="w-4 h-4 animate-spin" />
        בדיקה בתהליך...
      </div>
    );
  }
  if (!status) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-muted text-muted-foreground font-semibold text-sm">
        <Activity className="w-4 h-4" />
        טרם הורצו בדיקות
      </div>
    );
  }
  const failed = status.summary.failed;
  const warned = status.summary.warned;
  if (failed > 0) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-destructive/10 text-destructive font-semibold text-sm">
        <XCircle className="w-4 h-4" />
        בעיות זוהו ({failed} נכשלו)
      </div>
    );
  }
  if (warned > 0) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/10 text-amber-800 dark:text-amber-300 font-semibold text-sm">
        <AlertTriangle className="w-4 h-4" />
        אזהרות ({warned})
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-status-ok/10 text-status-ok font-semibold text-sm">
      <ShieldCheck className="w-4 h-4" />
      {t.stabilityPage.allChecksHealthy}
    </div>
  );
}

function SuiteSection({ suite, results }: { suite: Suite; results: TestResult[] }) {
  const [expanded, setExpanded] = useState(true);
  const sl = suiteLabel(suite);
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const warned = results.filter((r) => r.status === "warn").length;

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between p-4 bg-muted/40 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className={cn("text-xs font-semibold px-2 py-0.5 rounded", sl.className)}>{sl.label}</span>
          <span className="font-medium text-sm">{results.length} tests</span>
          <span className="text-xs text-green-600 dark:text-green-400">{passed} עברו</span>
          {failed > 0 && <span className="text-xs text-red-600 dark:text-red-400">{failed} נכשלו</span>}
          {warned > 0 && <span className="text-xs text-amber-600 dark:text-amber-400">{warned} אזהרות</span>}
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      {expanded && (
        <div className="divide-y dark:divide-gray-700">
          {results.map((r) => (
            <div key={r.id} className="p-3 flex flex-col gap-1 text-sm bg-background">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium flex-1 min-w-0 truncate">{r.name}</span>
                <div className="flex items-center gap-2 shrink-0">
                  {r.durationMs > 0 && (
                    <span className="text-xs text-muted-foreground font-mono">{r.durationMs}ms</span>
                  )}
                  {statusBadge(r.status)}
                </div>
              </div>
              {(r.expected || r.actual) && (
                <div className="flex gap-4 text-xs text-muted-foreground font-mono">
                  {r.expected && <span>צפוי: <span className="text-foreground">{r.expected}</span></span>}
                  {r.actual && <span>בפועל: <span className={cn(r.status === "fail" ? "text-red-500" : "text-foreground")}>{r.actual}</span></span>}
                </div>
              )}
              {r.detail && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">{r.detail}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const SCHEDULE_OPTIONS = [
  { label: t.stabilityPage.disabled, value: 0 },
  { label: t.stabilityPage.everyTwoHours, value: 2 },
  { label: t.stabilityPage.everyFourHours, value: 4 },
  { label: t.stabilityPage.everyEightHours, value: 8 },
  { label: t.stabilityPage.everyTwelveHours, value: 12 },
  { label: t.stabilityPage.everyTwentyFourHours, value: 24 },
];

const exportStabilityPDF = (report: TestReport) => { 
  const doc = new jsPDF(); 
  doc.setFont("helvetica", "bold"); doc.setFontSize(20); 
  doc.text("VetTrack Stability Report", 14, 22); 
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); 
  doc.text(`Run ID: ${report.runId}`, 14, 30); 
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 35); 
  let y = 45; 
  doc.setLineWidth(0.5); doc.line(14, y, 196, y); y += 10; 
  doc.setFontSize(12); doc.text("Summary:", 14, y); y += 7; 
  doc.setFontSize(10); 
  doc.text(`Passed: ${report.summary.passed} | Failed: ${report.summary.failed} | Latency: ${report.summary.avgLatencyMs}ms`, 14, y); 
  y += 15; 
  report.results.forEach((res, i) => { 
    if (y > 270) { doc.addPage(); y = 20; } 
    doc.setTextColor(0, 0, 0); doc.text(`${i + 1}. ${res.name}`, 14, y); 
    const color = res.status === "pass" ? [0, 128, 0] : res.status === "fail" ? [200, 0, 0] : [214, 158, 0]; 
    doc.setTextColor(color[0], color[1], color[2]); 
    doc.text(res.status.toUpperCase(), 170, y); 
    y += 7; 
  }); 
  doc.save(`VetTrack-Stability-${report.runId}.pdf`); 
};
export default function StabilityDashboardPage() {
  const { isAdmin, userId } = useAuth();
  const qc = useQueryClient();
  const [logSearch, setLogSearch] = useState("");
  const [logLimit] = useState(150);

  const { data: statusData, isLoading: statusLoading } = useQuery<StabilityStatus>({
    queryKey: ["/api/stability/status"],
    queryFn: fetchStatus,
    enabled: isAdmin && !!userId,
    refetchInterval: leaderPoll(5000),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const { data: results } = useQuery<TestReport>({
    queryKey: ["/api/stability/results"],
    queryFn: fetchResults,
    refetchInterval: () => {
      if (document.hidden) return false;
      if (!isLeader()) return false;
      return statusData?.running ? 3000 : 10000;
    },
    refetchIntervalInBackground: false,
    enabled: isAdmin && !!userId && !statusLoading,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const { data: logs = [], isLoading: logsLoading } = useQuery<LogEntry[]>({
    queryKey: ["/api/stability/logs", logLimit, logSearch],
    queryFn: () => fetchLogs(logLimit, logSearch),
    enabled: isAdmin && !!userId,
    refetchInterval: leaderPoll(5000),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const response = await authFetch(`${API}/run`, { method: "POST" });
      return response.json();
    },
    onSuccess: () => {
      toast.success(t.stabilityPage.runStarted);
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["/api/stability/status"] });
        qc.invalidateQueries({ queryKey: ["/api/stability/results"] });
      }, 1000);
    },
    onError: () => toast.error(t.stabilityPage.runStartFailed),
  });

  const testModeMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      authFetch(`${API}/test-mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      }).then((r) => r.json()),
    onSuccess: (_, enabled) => {
      toast.success(enabled ? t.stabilityPage.testModeEnabled : t.stabilityPage.testModeDisabled);
      qc.invalidateQueries({ queryKey: ["/api/stability/status"] });
    },
  });

  const scheduleMutation = useMutation({
    mutationFn: (hours: number) =>
      authFetch(`${API}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hours }),
      }).then((r) => r.json()),
    onSuccess: (data) => {
      toast.success(data.message);
      qc.invalidateQueries({ queryKey: ["/api/stability/status"] });
    },
  });

  const clearLogsMutation = useMutation({
    mutationFn: () =>
      authFetch(`${API}/logs`, { method: "DELETE" }).then((r) => r.json()),
    onSuccess: () => {
      toast.success(t.stabilityPage.logsCleared);
      qc.invalidateQueries({ queryKey: ["/api/stability/logs"] });
    },
  });

  if (!isAdmin) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
          <ShieldCheck className="w-12 h-12 text-muted-foreground" />
          <p className="text-muted-foreground">נדרשת גישת מנהל</p>
          <Button asChild variant="outline"><Link href="/home">לדף הבית</Link></Button>
        </div>
      </Layout>
    );
  }

  const status = statusData;
  const report = results;
  const summary = report?.summary;
  const isRunning = status?.running ?? false;

  const functionalResults = report?.results.filter((r) => r.suite === "functional") ?? [];
  const stressResults = report?.results.filter((r) => r.suite === "stress") ?? [];
  const edgeResults = report?.results.filter((r) => r.suite === "edge") ?? [];

  return (
    <Layout>
      <Helmet>
        <title>{t.stabilityPage.titleFull}</title>
      </Helmet>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <FlaskConical className="w-6 h-6 text-primary" />
              {t.stabilityPage.title}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t.stabilityPage.subtitle}
            </p>
          </div>
          <SystemStatusBadge status={report ?? null} running={isRunning} />
        </div>

        {/* Controls Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Run button */}
          <Card>
            <CardContent className="p-4 flex flex-col gap-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">חבילת בדיקות</p>
              <Button
                onClick={() => runMutation.mutate()}
                disabled={isRunning || runMutation.isPending}
                className="gap-2 w-full"
              >
                {isRunning ? (
                  <><RefreshCw className="w-4 h-4 animate-spin" />מריץ...</>
                ) : (
                  <><Play className="w-4 h-4" />{t.stabilityPage.runAllTests}</>
                )}
              </Button>
              {report?.finishedAt && (
                <p className="text-xs text-muted-foreground text-center">
                  ריצה אחרונה: {format(new Date(report.finishedAt), "HH:mm:ss")}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Testing Mode */}
          <Card>
            <CardContent className="p-4 flex flex-col gap-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">מצב בדיקה</p>
              <button
                onClick={() => testModeMutation.mutate(!(status?.testModeEnabled ?? false))}
                disabled={testModeMutation.isPending}
                className="flex items-center gap-3 py-2 px-3 rounded-lg border hover:bg-muted/50 transition-colors w-full"
              >
                {status?.testModeEnabled ? (
                  <ToggleRight className="w-5 h-5 text-primary" />
                ) : (
                  <ToggleLeft className="w-5 h-5 text-muted-foreground" />
                )}
                <span className={cn("text-sm font-medium", status?.testModeEnabled ? "text-primary" : "text-muted-foreground")}>
                  {status?.testModeEnabled ? t.stabilityPage.enabled : t.stabilityPage.disabled}
                </span>
              </button>
              <p className="text-xs text-muted-foreground">הפעל להרצת בדיקות CRUD בבטחה עם נתוני בדיקה מבודדים</p>
            </CardContent>
          </Card>

          {/* Schedule */}
          <Card>
            <CardContent className="p-4 flex flex-col gap-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                <CalendarClock className="w-3.5 h-3.5" />תזמון אוטומטי
              </p>
              <select
                value={status?.scheduleHours ?? 0}
                onChange={(e) => scheduleMutation.mutate(Number(e.target.value))}
                className="w-full text-sm border rounded-lg px-3 py-2 bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                disabled={scheduleMutation.isPending}
              >
                {SCHEDULE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              {(status?.scheduleHours ?? 0) > 0 && (
                <p className="text-xs text-green-600 dark:text-green-400">
                  הריצה הבאה מתוזמנת אוטומטית כל {status!.scheduleHours} שעות
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Summary Stats */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "עבר", value: summary.passed, icon: <CheckCircle2 className="w-4 h-4" />, color: "text-green-600 dark:text-green-400" },
              { label: "נכשל", value: summary.failed, icon: <XCircle className="w-4 h-4" />, color: "text-red-600 dark:text-red-400" },
              { label: "השהייה ממוצעת", value: `${summary.avgLatencyMs}ms`, icon: <Zap className="w-4 h-4" />, color: "text-primary" },
              { label: "השהייה מקסימלית", value: `${summary.maxLatencyMs}ms`, icon: <Activity className="w-4 h-4" />, color: summary.maxLatencyMs > 3000 ? "text-red-600" : "text-muted-foreground" },
            ].map((stat) => (
              <Card key={stat.label}>
                <CardContent className="p-4 flex flex-col gap-1">
                  <div className={cn("flex items-center gap-1.5 text-xs font-semibold text-muted-foreground")}>
                    <span className={stat.color}>{stat.icon}</span>
                    {stat.label}
                  </div>
                  <p className={cn("text-2xl font-bold", stat.color)}>{stat.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* test results */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="w-4 h-4" />
              {t.stabilityPage.testResults}
              {isRunning && <RefreshCw className="w-3.5 h-3.5 animate-spin text-muted-foreground ml-auto" />}
              {report?.status === "done" && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto h-7 gap-1.5 text-[10px] font-bold border-primary/20 hover:bg-primary/5"
                  onClick={() => exportStabilityPDF(report)}
                >
                  <FileText className="w-3.5 h-3.5" />
                  דוח PDF
                </Button>
                <Badge variant="outline" className="ml-auto text-xs">
                  {format(new Date(report.finishedAt!), "dd MMM HH:mm:ss")}
                </Badge>
              </>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {statusLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : !report || report.results.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-3">
                <FlaskConical className="w-10 h-10 opacity-30" />
                <p className="text-sm">{t.stabilityPage.noResultsHint}</p>
              </div>
            ) : (
              <>
                {functionalResults.length > 0 && (
                  <SuiteSection suite="functional" results={functionalResults} />
                )}
                {stressResults.length > 0 && (
                  <SuiteSection suite="stress" results={stressResults} />
                )}
                {edgeResults.length > 0 && (
                  <SuiteSection suite="edge" results={edgeResults} />
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* internal action log */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="w-4 h-4" />
              {t.stabilityPage.internalLog}
              <span className="ml-auto text-xs font-normal text-muted-foreground">{logs.length} רשומות</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="חיפוש בלוגים..."
                  className="ps-9"
                  value={logSearch}
                  onChange={(e) => setLogSearch(e.target.value)}
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={() => clearLogsMutation.mutate()}
                disabled={clearLogsMutation.isPending}
                title="נקה את כל הלוגים"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => qc.invalidateQueries({ queryKey: ["/api/stability/logs"] })}
                title="רענן לוגים"
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
            <div className="rounded-lg border dark:border-gray-700 overflow-hidden">
              <div className="max-h-80 overflow-y-auto font-mono text-xs divide-y dark:divide-gray-700">
                {logsLoading ? (
                  <div className="p-4 text-muted-foreground">טוען לוגים...</div>
                ) : logs.length === 0 ? (
                  <div className="p-4 text-muted-foreground">אין רשומות לוג{logSearch ? " התואמות לחיפוש" : ""}.</div>
                ) : (
                  logs.map((entry) => (
                    <div key={entry.id} className="flex gap-2 px-3 py-1.5 hover:bg-muted/50 transition-colors">
                      <span className="text-muted-foreground shrink-0 tabular-nums">
                        {format(new Date(entry.timestamp), "HH:mm:ss")}
                      </span>
                      <span className={cn("shrink-0 w-14 font-semibold", logLevelColor(entry.level))}>
                        {entry.level.toUpperCase()}
                      </span>
                      <span className="text-muted-foreground shrink-0">[{entry.category}]</span>
                      <span className="flex-1 truncate">{entry.action}</span>
                      {entry.detail && (
                        <span className="text-muted-foreground shrink-0 truncate max-w-[120px]" title={entry.detail}>
                          {entry.detail}
                        </span>
                      )}
                      {entry.durationMs !== undefined && (
                        <span className="text-muted-foreground shrink-0">{entry.durationMs}ms</span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              הלוגים מתרעננים אוטומטית כל 5 שניות. עד 1,000 רשומות נשמרות בזיכרון (מתאפס עם הפעלת השרת מחדש).
            </p>
          </CardContent>
        </Card>

        {/* Test Layer Reference */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" />
              מה נבדק
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-3 pt-0">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <p className="font-semibold text-foreground mb-1 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-primary inline-block" />פונקציונלי
                </p>
                <ul className="space-y-0.5 text-xs list-disc list-inside">
                  <li>בריאות שרת וזמן פעולה</li>
                  <li>רשימת ציוד ופרטים</li>
                  <li>נקודת קצה לניתוח</li>
                  <li>פיד פעילות ומשתמשים</li>
                  <li>CRUD ציוד (מצב בדיקה)</li>
                  <li>זרימת סריקת QR (מצב בדיקה)</li>
                </ul>
              </div>
              <div>
                <p className="font-semibold text-foreground mb-1 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-secondary-foreground/70 inline-block" />עומס
                </p>
                <ul className="space-y-0.5 text-xs list-disc list-inside">
                  <li>5 בקשות רשימה במקביל</li>
                  <li>10 בקשות רצופות מהירות</li>
                  <li>3 קריאות ניתוח במקביל</li>
                  <li>זיהוי קפיצת השהייה</li>
                  <li>בדיקת ירידת ביצועים</li>
                </ul>
              </div>
              <div>
                <p className="font-semibold text-foreground mb-1 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-muted-foreground inline-block" />מקרי קצה
                </p>
                <ul className="space-y-0.5 text-xs list-disc list-inside">
                  <li>שדות חובה חסרים → 400</li>
                  <li>משאב לא קיים → 404</li>
                  <li>סטטוס סריקה לא חוקי → 4xx</li>
                  <li>גוף בקשה ריק → 400</li>
                  <li>שדה 5000 תווים (XSS/overflow)</li>
                  <li>סריקה כפולה (מצב בדיקה)</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
