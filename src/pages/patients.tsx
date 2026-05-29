import { useState, useCallback, useRef } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  Clock,
  Heart,
  LogOut,
  Plus,
  Search,
  Siren,
  UserRound,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import { DischargePatientDialog } from "@/components/patients/DischargePatientDialog";
import { Layout } from "@/components/layout";
import { PageShell } from "@/components/layout/PageShell";
import { Stethoscope, Map } from "lucide-react";
import type { SidebarItem } from "@/components/layout/IconSidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import type { AdmitPatientRequest, AnimalSearchResult, Hospitalization, HospitalizationStatus } from "@/types";

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<HospitalizationStatus, { label: string; dot: string; badge: string }> = {
  admitted:    { label: "מאושפז",     dot: "bg-blue-500",    badge: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800" },
  observation: { label: "מעקב",      dot: "bg-amber-500",   badge: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800" },
  critical:    { label: "קריטי",     dot: "bg-red-500 animate-pulse", badge: "bg-red-100 text-red-800 border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-800" },
  recovering:  { label: "מתאושש",    dot: "bg-emerald-500", badge: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800" },
  discharged:  { label: "שוחרר",     dot: "bg-muted-foreground", badge: "bg-muted text-muted-foreground border-border" },
  deceased:    { label: "נפטר",      dot: "bg-gray-400",    badge: "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-900/50 dark:text-gray-400" },
};

const FILTER_TABS: Array<{ key: string; label: string }> = [
  { key: "", label: "הכל" },
  { key: "critical", label: "קריטי" },
  { key: "observation", label: "מעקב" },
  { key: "recovering", label: "מתאושש" },
  { key: "admitted", label: "מאושפז" },
];

const SPECIES_OPTIONS = ["כלב", "חתול", "ציפור", "ארנב", "שאר"];

// ─── Duration helper ──────────────────────────────────────────────────────────

function admissionDuration(admittedAt: string): string {
  const ms = Date.now() - new Date(admittedAt).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "פחות משעה";
  if (h < 24) return `${h} שע'`;
  const d = Math.floor(h / 24);
  return `${d} יום${d > 1 ? "ות" : ""}`;
}

// ─── Patient card ─────────────────────────────────────────────────────────────

function PatientCard({ p, onDischarge }: { p: Hospitalization; onDischarge: () => void }) {
  const cfg = STATUS_CONFIG[p.status] ?? STATUS_CONFIG.admitted;
  const meta = [p.animal.species, p.animal.breed].filter(Boolean).join(" · ");
  const location = [p.ward, p.bay].filter(Boolean).join(" / ");
  const pp = t.patientsPage;

  return (
    <Card className="group border-border/60 bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md active:translate-y-0">
      <CardContent className="flex items-start gap-2 p-4">
        <Link href={`/patients/${p.animal.id}`} className="flex min-w-0 flex-1 items-start gap-3">
          {/* Status dot */}
          <span className="mt-1.5 flex h-2.5 w-2.5 shrink-0 items-center justify-center">
            <span className={`h-2.5 w-2.5 rounded-full ${cfg.dot}`} />
          </span>

          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-start justify-between gap-2">
              <p className="truncate text-base font-semibold leading-tight text-foreground">{p.animal.name}</p>
              <Badge variant="outline" className={`shrink-0 rounded-full px-2 py-0 text-[11px] font-medium border ${cfg.badge}`}>
                {cfg.label}
              </Badge>
            </div>

            {meta && <p className="text-xs text-muted-foreground">{meta}</p>}

            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              {p.owner && (
                <span className="inline-flex items-center gap-1">
                  <UserRound className="h-3 w-3 shrink-0" />
                  {p.owner.fullName}
                </span>
              )}
              {location && (
                <span className="inline-flex items-center gap-1">
                  <Activity className="h-3 w-3 shrink-0" />
                  {location}
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3 shrink-0" />
                {admissionDuration(p.admittedAt)}
              </span>
            </div>

            {p.admissionReason && (
              <p className="truncate text-xs text-muted-foreground/80 italic">{p.admissionReason}</p>
            )}
          </div>

          <ArrowUpRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground" />
        </Link>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
          title={pp.removeFromList}
          aria-label={pp.removeFromListAria.replace("{name}", p.animal.name)}
          onClick={onDischarge}
          data-testid={`btn-discharge-patient-${p.id}`}
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Admit sheet ──────────────────────────────────────────────────────────────

function AdmitSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { userId } = useAuth();
  const [searchQ, setSearchQ] = useState("");
  const [selectedAnimal, setSelectedAnimal] = useState<AnimalSearchResult | null>(null);
  const [form, setForm] = useState<AdmitPatientRequest>({});
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();

  const searchQ_debounced = useRef("");
  const [suggestions, setSuggestions] = useState<AnimalSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const admitMut = useMutation({
    mutationFn: (data: AdmitPatientRequest) => api.patients.admit(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/patients"] });
      toast.success("מטופל אושפז בהצלחה");
      handleClose();
    },
    onError: (e: Error) => toast.error(e.message || "שגיאה באישפוז"),
  });

  function handleClose() {
    setSearchQ("");
    setSelectedAnimal(null);
    setForm({});
    setSuggestions([]);
    onClose();
  }

  function handleSearchChange(v: string) {
    setSearchQ(v);
    if (selectedAnimal) setSelectedAnimal(null);
    clearTimeout(searchTimeout.current);
    if (!v.trim()) { setSuggestions([]); return; }
    searchTimeout.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const r = await api.patients.search(v);
        setSuggestions(r.animals);
      } catch { setSuggestions([]); }
      finally { setSearchLoading(false); }
    }, 300);
  }

  function selectAnimal(a: AnimalSearchResult) {
    setSelectedAnimal(a);
    setSearchQ(a.name);
    setSuggestions([]);
    setForm((f) => ({ ...f, animalId: a.id, animalName: undefined }));
  }

  function clearAnimal() {
    setSelectedAnimal(null);
    setSearchQ("");
    setForm((f) => ({ ...f, animalId: undefined }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: AdmitPatientRequest = selectedAnimal
      ? { ...form, animalId: selectedAnimal.id }
      : { ...form, animalName: searchQ.trim() || form.animalName };
    if (!payload.animalId && !payload.animalName?.trim()) {
      toast.error("נדרש שם מטופל");
      return;
    }
    admitMut.mutate(payload);
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && handleClose()}>
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-2xl">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2 text-lg">
            <Heart className="h-5 w-5 text-red-500" />
            אישפוז מטופל
          </SheetTitle>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pb-6">
          {/* Animal search / name */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">שם המטופל *</Label>
            <div className="relative">
              <Input
                value={searchQ}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="חפש מטופל קיים או הזן שם חדש..."
                autoComplete="off"
                className="pe-10"
              />
              {selectedAnimal && (
                <button
                  type="button"
                  onClick={clearAnimal}
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Suggestions dropdown */}
            {suggestions.length > 0 && !selectedAnimal && (
              <div className="rounded-xl border border-border bg-background shadow-md">
                {suggestions.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => selectAnimal(a)}
                    className="flex w-full items-start gap-2 px-3 py-2.5 text-start text-sm hover:bg-muted/60"
                  >
                    <span className="font-medium text-foreground">{a.name}</span>
                    {(a.species || a.breed) && (
                      <span className="text-muted-foreground">· {[a.species, a.breed].filter(Boolean).join(", ")}</span>
                    )}
                    {a.ownerName && (
                      <span className="ms-auto shrink-0 text-xs text-muted-foreground">{a.ownerName}</span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {selectedAnimal && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400">
                ✓ מטופל קיים נבחר — ההיסטוריה שמורה
              </p>
            )}
          </div>

          {/* Species — only for new animals */}
          {!selectedAnimal && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">מין</Label>
                <Select onValueChange={(v) => setForm((f) => ({ ...f, species: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="בחר..." />
                  </SelectTrigger>
                  <SelectContent>
                    {SPECIES_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">גזע</Label>
                <Input
                  value={form.breed ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, breed: e.target.value }))}
                  placeholder="גזע (אופציונלי)"
                />
              </div>
            </div>
          )}

          {/* Admission reason */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">סיבת אישפוז</Label>
            <Textarea
              value={form.admissionReason ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, admissionReason: e.target.value }))}
              placeholder="תאר את הסיבה לאישפוז..."
              rows={2}
              className="resize-none"
            />
          </div>

          {/* Ward / Bay */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">מחלקה</Label>
              <Input
                value={form.ward ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, ward: e.target.value }))}
                placeholder="כגון: ICU, כירורגי"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">עמדה / כלוב</Label>
              <Input
                value={form.bay ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, bay: e.target.value }))}
                placeholder="כגון: A3"
              />
            </div>
          </div>

          {/* Owner — only for new animals */}
          {!selectedAnimal && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">שם בעלים</Label>
                <Input
                  value={form.ownerName ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, ownerName: e.target.value }))}
                  placeholder="שם מלא"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">טלפון</Label>
                <Input
                  value={form.ownerPhone ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, ownerPhone: e.target.value }))}
                  placeholder="05X-XXXXXXX"
                  type="tel"
                />
              </div>
            </div>
          )}

          <Button type="submit" className="w-full" size="lg" disabled={admitMut.isPending}>
            {admitMut.isPending ? "מאשפז..." : "אשפז מטופל"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PatientsPage() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [admitOpen, setAdmitOpen] = useState(false);
  const [dischargeTarget, setDischargeTarget] = useState<Hospitalization | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["/api/patients", search, statusFilter],
    queryFn: () => api.patients.list({ q: search || undefined, status: statusFilter || undefined }),
    enabled: Boolean(userId),
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: false,
    refetchOnWindowFocus: true,
  });

  const patients = data?.patients ?? [];
  const criticalCount = patients.filter((p) => p.status === "critical").length;

  const PATIENTS_SIDEBAR: SidebarItem[] = [
    { href: "/patients", icon: Stethoscope, label: "Patients" },
    { href: "/rooms",    icon: Map,         label: "Rooms" },
  ];

  const isDesktop = typeof window !== "undefined" && window.innerWidth >= 1024;
  const pageContent = (
    <>
      <Helmet>
        <title>מטופלים פעילים — VetTrack</title>
      </Helmet>

      <div className="motion-safe:animate-page-enter pb-24 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              מטופלים פעילים
            </h1>
            {!isLoading && (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {patients.length} מאושפז{patients.length !== 1 ? "ים" : ""}
                {criticalCount > 0 && (
                  <span className="ms-2 inline-flex items-center gap-1 text-red-600 dark:text-red-400">
                    <Siren className="h-3.5 w-3.5" />
                    {criticalCount} קריטי
                  </span>
                )}
              </p>
            )}
          </div>
          <Button onClick={() => setAdmitOpen(true)} size="sm" className="shrink-0 gap-1.5">
            <Plus className="h-4 w-4" />
            אשפוז
          </Button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חפש לפי שם מטופל או בעלים..."
            className="ps-9"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Status filter tabs */}
        <div className="flex gap-2 overflow-x-auto pb-0.5 no-scrollbar">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                statusFilter === tab.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="border-border/60">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Skeleton className="mt-1.5 h-2.5 w-2.5 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-5 w-40" />
                      <Skeleton className="h-3 w-24" />
                      <Skeleton className="h-3 w-32" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : isError ? (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="flex items-center gap-3 p-4">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <div>
                <p className="text-sm font-medium text-foreground">שגיאה בטעינה</p>
                <button onClick={() => refetch()} className="text-xs text-primary underline">
                  נסה שוב
                </button>
              </div>
            </CardContent>
          </Card>
        ) : patients.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border/60 bg-muted/10 px-6 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-background shadow-inner ring-1 ring-border/50">
              <Heart className="h-7 w-7 text-muted-foreground" />
            </div>
            <div>
              <p className="text-base font-semibold text-foreground">
                {search || statusFilter ? "לא נמצאו מטופלים" : "אין מטופלים מאושפזים"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {search || statusFilter
                  ? "נסה לשנות את הסינון"
                  : "לחץ על 'אשפוז' כדי להוסיף מטופל"}
              </p>
            </div>
            {!search && !statusFilter && (
              <Button onClick={() => setAdmitOpen(true)} variant="outline" size="sm" className="gap-1.5">
                <Plus className="h-4 w-4" />
                אשפז מטופל ראשון
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-2.5">
            {patients.map((p) => (
              <PatientCard key={p.id} p={p} onDischarge={() => setDischargeTarget(p)} />
            ))}
          </div>
        )}
      </div>

      <AdmitSheet open={admitOpen} onClose={() => setAdmitOpen(false)} />

      <DischargePatientDialog
        patient={dischargeTarget}
        open={dischargeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDischargeTarget(null);
        }}
      />
    </>
  );
  if (isDesktop) {
    return <PageShell sidebarItems={PATIENTS_SIDEBAR}>{pageContent}</PageShell>;
  }
  return <Layout>{pageContent}</Layout>;
}
