// src/pages/crash-cart.tsx
import { useState, useEffect } from "react";
import { useSearch, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, Circle, AlertTriangle, Clock, Settings, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorCard } from "@/components/ui/error-card";
import { authFetch } from "@/lib/auth-fetch";
import { useAuth } from "@/hooks/use-auth";
import { useDirection } from "@/hooks/useDirection";
import { api } from "@/lib/api";
import { t, formatDateByLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { haptics } from "@/lib/haptics";
import { CrashCartAdminSheet } from "@/components/crash-cart-admin-sheet";
import type { CrashCartItem } from "@/types";

interface CartCheckData {
  latest: { performedAt: string; allPassed: boolean; performedByName: string } | null;
  checkedToday: boolean;
  recentChecks: Array<{ id: string; performedAt: string; allPassed: boolean; performedByName: string }>;
  criticalPatients: Array<{
    hospitalizationId: string;
    animalName: string;
    species: string;
    weightKg: number | null;
    ward: string | null;
    bay: string | null;
  }>;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 0) return t.crashCart.relativeHoursMinutes(h, m);
  return t.crashCart.relativeMinutes(m);
}

export default function CrashCartCheckPage() {
  const { userId, isAdmin } = useAuth();
  const dir = useDirection();
  const queryClient = useQueryClient();
  const searchStr = useSearch();
  const [, navigate] = useLocation();
  const configureFromUrl = new URLSearchParams(searchStr).get("configure") === "1";
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [adminSheetOpen, setAdminSheetOpen] = useState(false);

  useEffect(() => {
    if (configureFromUrl && isAdmin) {
      setAdminSheetOpen(true);
    }
  }, [configureFromUrl, isAdmin]);

  const itemsQ = useQuery({
    queryKey: ["/api/crash-cart/items"],
    queryFn: () => api.crashCartItems.list(),
    enabled: !!userId,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const cartItems: CrashCartItem[] = itemsQ.data ?? [];
  const allChecked = cartItems.length > 0 && cartItems.every((i) => checked[i.id]);

  const latestQ = useQuery<CartCheckData>({
    queryKey: ["/api/crash-cart/checks/latest"],
    queryFn: async () => {
      const res = await authFetch("/api/crash-cart/checks/latest");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    enabled: !!userId,
    refetchOnWindowFocus: false,
  });

  const submit = useMutation({
    mutationFn: async ({ wasAllChecked: _wasAllChecked }: { wasAllChecked: boolean }) => {
      const items = cartItems.map((i) => ({ key: i.key, label: i.label, checked: !!checked[i.id] }));
      const res = await authFetch("/api/crash-cart/checks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, notes: notes || undefined }),
      });
      if (!res.ok) throw new Error("submit failed");
      return res.json();
    },
    onSuccess: (_data, { wasAllChecked }) => {
      setSubmitted(true);
      queryClient.invalidateQueries({ queryKey: ["/api/crash-cart/checks/latest"] });
      if (wasAllChecked) haptics.scanSuccess();
    },
    onError: () => {
      toast.error(t.crashCart.saveError);
    },
  });

  const toggle = (id: string) => {
    haptics.tap();
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const criticalPatients = latestQ.data?.criticalPatients ?? [];
  const recentChecks = latestQ.data?.recentChecks ?? [];

  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) window.history.back();
    else navigate("/home");
  };

  const backButton = (
    <button
      type="button"
      onClick={handleBack}
      aria-label={t.common.back}
      data-testid="crash-cart-back"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted motion-safe:active:scale-95"
    >
      <ArrowRight className="h-5 w-5" aria-hidden />
    </button>
  );

  if (latestQ.isError) {
    return (
      <div className="min-h-screen bg-background p-4 max-w-2xl mx-auto" dir={dir}>
        <div className="flex items-center gap-2 mb-4">{backButton}</div>
        <ErrorCard message={t.crashCart.loadError} onRetry={() => latestQ.refetch()} />
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-background overflow-hidden" dir={dir} style={{ height: "100%", paddingTop: "calc(env(safe-area-inset-top) + 16px)" }}>
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-3 border-b border-border">
        {backButton}
        <CheckCircle2 className="h-6 w-6 text-[var(--status-ok-fg)]" />
        <h1 className="text-xl font-bold flex-1">{t.crashCart.title}</h1>
        {isAdmin && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2"
            onClick={() => setAdminSheetOpen(true)}
            aria-label={t.crashCart.settingsAria}
          >
            <Settings className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4">

      {/* Last check status */}
      {latestQ.data && (
        <div className={cn(
          "rounded-lg border p-3 mb-4 text-sm",
          latestQ.data.checkedToday
            ? "border-[var(--status-ok-border)] bg-[var(--status-ok-bg)] text-[var(--status-ok-fg)]"
            : "border-[var(--status-stale-border)] bg-[var(--status-stale-bg)] text-[var(--status-stale-fg)]",
        )}>
          {latestQ.data.checkedToday && latestQ.data.latest ? (
            <span>
              {t.crashCart.checkedAgo(
                formatRelativeTime(latestQ.data.latest.performedAt),
                latestQ.data.latest.performedByName,
              )}
            </span>
          ) : (
            <span>{t.crashCart.notCheckedToday}</span>
          )}
        </div>
      )}

      {/* High-risk patients */}
      {criticalPatients.length > 0 && (
        <div className="rounded-lg border border-[var(--status-issue-border)] bg-[var(--status-issue-bg)] p-3 mb-4">
          <div className="flex items-center gap-2 mb-2 text-[var(--status-issue-fg)] text-sm font-semibold">
            <AlertTriangle className="h-4 w-4" />
            {t.crashCart.highRiskPatients(criticalPatients.length)}
          </div>
          <div className="flex flex-col gap-1">
            {criticalPatients.map((p) => (
              <div key={p.hospitalizationId} className="text-xs text-foreground flex gap-2">
                <span className="font-medium">{p.animalName}</span>
                <span className="text-muted-foreground">{p.species}{p.weightKg ? ` · ${t.crashCart.weightKg(p.weightKg)}` : ""}</span>
                {(p.ward || p.bay) && <span className="text-muted-foreground">· {[p.ward, p.bay].filter(Boolean).join(" / ")}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Clinic-specific checklist (admin configures; staff sees hint) */}
      <div className="rounded-lg border border-border bg-muted/80 p-4 mb-4">
        <div className="flex items-start gap-3">
          <ListChecks className="h-5 w-5 text-primary shrink-0 mt-0.5" aria-hidden />
          <div className="flex-1 min-w-0 space-y-2">
            <p className="text-sm font-semibold text-foreground">{t.crashCart.customizeTitle}</p>
            <p className="text-xs text-muted-foreground leading-relaxed">{t.crashCart.customizeDescription}</p>
            {isAdmin ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-1"
                onClick={() => setAdminSheetOpen(true)}
                data-testid="crash-cart-customize"
              >
                <Settings className="h-4 w-4 ms-1" aria-hidden />
                {t.crashCart.customizeButton}
              </Button>
            ) : (
              <p className="text-xs text-[var(--status-stale-fg)]">{t.crashCart.nonAdminHint}</p>
            )}
          </div>
        </div>
      </div>

      {/* Checklist */}
      {itemsQ.isPending ? (
        <div className="rounded-lg border border-border bg-muted p-4 mb-4">
          <p className="text-sm text-muted-foreground">{t.crashCart.loadingItems}</p>
        </div>
      ) : !submitted ? (
        <div className="rounded-lg border border-border bg-muted p-4 mb-4">
          <h2 className="text-sm font-semibold text-muted-foreground mb-3">{t.crashCart.itemsToCheck}</h2>
          <div className="flex flex-col gap-3">
            {cartItems.map((item) => {
              const isChecked = !!checked[item.id];
              return (
              <button
                key={item.id}
                type="button"
                aria-pressed={isChecked}
                aria-label={t.crashCart.checkItemAria(item.label, isChecked)}
                onClick={() => toggle(item.id)}
                className={cn(
                  "flex items-center gap-3 text-end p-3 rounded-lg border transition-colors min-h-[44px]",
                  isChecked
                    ? "border-[var(--status-ok-border)] bg-[var(--status-ok-bg)] text-[var(--status-ok-fg)] ring-2 ring-[var(--status-ok-border)]"
                    : "border-border bg-background text-foreground hover:border-primary/40",
                )}
              >
                {isChecked
                  ? <CheckCircle2 className="h-6 w-6 text-[var(--status-ok-fg)] shrink-0" aria-hidden />
                  : <Circle className="h-6 w-6 text-muted-foreground shrink-0" aria-hidden />
                }
                <span className={cn("text-sm flex-1 text-start", isChecked && "font-semibold")}>{item.label}</span>
              </button>
            );})}
          </div>

          {!allChecked && (
            <textarea
              className="mt-3 w-full rounded border border-border bg-background p-2 text-sm text-foreground placeholder-muted-foreground"
              placeholder={t.crashCart.missingItemsNotesPlaceholder}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          )}

          <Button
            className="mt-4 w-full"
            variant={allChecked ? "default" : "outline"}
            onClick={() => submit.mutate({ wasAllChecked: allChecked })}
            disabled={submit.isPending || cartItems.length === 0}
          >
            {allChecked ? t.crashCart.saveAllOk : t.crashCart.saveWithMissing}
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--status-ok-border)] bg-[var(--status-ok-bg)] p-4 mb-4 text-center text-[var(--status-ok-fg)]">
          <CheckCircle2 className="h-8 w-8 mx-auto mb-2" />
          <p className="font-semibold">{t.crashCart.checkSaved}</p>
        </div>
      )}

      {/* Recent history */}
      {recentChecks.length > 0 && (
        <div className="rounded-lg border border-border bg-muted p-4">
          <h2 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4" /> {t.crashCart.historyTitle}
          </h2>
          <div className="flex flex-col gap-2">
            {recentChecks.map((check) => (
              <div key={check.id} className="flex justify-between items-center text-xs text-muted-foreground">
                <span>{formatDateByLocale(check.performedAt, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                <span className="text-muted-foreground/70">{check.performedByName}</span>
                <span className={check.allPassed ? "text-[var(--status-ok-fg)]" : "text-[var(--status-issue-fg)]"}>
                  {check.allPassed ? t.crashCart.statusOk : t.crashCart.statusMissing}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      </div>

      {isAdmin && (
        <CrashCartAdminSheet open={adminSheetOpen} onOpenChange={setAdminSheetOpen} />
      )}
    </div>
  );
}
