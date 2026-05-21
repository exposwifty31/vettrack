// src/pages/crash-cart.tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, AlertTriangle, Clock, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorCard } from "@/components/ui/error-card";
import { authFetch } from "@/lib/auth-fetch";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/lib/api";
import { t, formatDateByLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
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
  const queryClient = useQueryClient();
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [adminSheetOpen, setAdminSheetOpen] = useState(false);

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
    mutationFn: async () => {
      const items = cartItems.map((i) => ({ key: i.key, label: i.label, checked: !!checked[i.id] }));
      const res = await authFetch("/api/crash-cart/checks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, notes: notes || undefined }),
      });
      if (!res.ok) throw new Error("submit failed");
      return res.json();
    },
    onSuccess: () => {
      setSubmitted(true);
      queryClient.invalidateQueries({ queryKey: ["/api/crash-cart/checks/latest"] });
    },
    onError: () => {
      toast.error(t.crashCart.saveError);
    },
  });

  const toggle = (id: string) => setChecked((prev) => ({ ...prev, [id]: !prev[id] }));

  const criticalPatients = latestQ.data?.criticalPatients ?? [];
  const recentChecks = latestQ.data?.recentChecks ?? [];

  if (latestQ.isError) {
    return (
      <div className="min-h-screen bg-background p-4 max-w-2xl mx-auto" dir="rtl">
        <ErrorCard message={t.crashCart.loadError} onRetry={() => latestQ.refetch()} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 max-w-2xl mx-auto" dir="rtl">
      <div className="flex items-center gap-2 mb-6">
        <CheckCircle2 className="h-6 w-6 text-green-500" />
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

      {/* Last check status */}
      {latestQ.data && (
        <div className={cn(
          "rounded-lg border p-3 mb-4 text-sm",
          latestQ.data.checkedToday
            ? "border-green-500/30 bg-green-500/10 text-green-400"
            : "border-amber-500/30 bg-amber-500/10 text-amber-400",
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
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 mb-4">
          <div className="flex items-center gap-2 mb-2 text-red-400 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4" />
            {t.crashCart.highRiskPatients(criticalPatients.length)}
          </div>
          <div className="flex flex-col gap-1">
            {criticalPatients.map((p) => (
              <div key={p.hospitalizationId} className="text-xs text-zinc-300 flex gap-2">
                <span className="font-medium">{p.animalName}</span>
                <span className="text-zinc-500">{p.species}{p.weightKg ? ` · ${t.crashCart.weightKg(p.weightKg)}` : ""}</span>
                {(p.ward || p.bay) && <span className="text-zinc-500">· {[p.ward, p.bay].filter(Boolean).join(" / ")}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Checklist */}
      {itemsQ.isPending ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 mb-4">
          <p className="text-sm text-zinc-500">{t.crashCart.loadingItems}</p>
        </div>
      ) : !submitted ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 mb-4">
          <h2 className="text-sm font-semibold text-zinc-400 mb-3">{t.crashCart.itemsToCheck}</h2>
          <div className="flex flex-col gap-3">
            {cartItems.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={!!checked[item.id]}
                onClick={() => toggle(item.id)}
                className={cn(
                  "flex items-center gap-3 text-right p-2 rounded-lg border transition-colors",
                  checked[item.id]
                    ? "border-green-500/40 bg-green-500/10 text-green-300"
                    : "border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-600",
                )}
              >
                {checked[item.id]
                  ? <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                  : <Circle className="h-5 w-5 text-zinc-600 shrink-0" />
                }
                <span className="text-sm">{item.label}</span>
              </button>
            ))}
          </div>

          {!allChecked && (
            <textarea
              className="mt-3 w-full rounded border border-zinc-700 bg-zinc-800 p-2 text-sm text-zinc-200 placeholder-zinc-500"
              placeholder={t.crashCart.missingItemsNotesPlaceholder}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          )}

          <Button
            className="mt-4 w-full"
            variant={allChecked ? "default" : "outline"}
            onClick={() => submit.mutate()}
            disabled={submit.isPending || cartItems.length === 0}
          >
            {allChecked ? t.crashCart.saveAllOk : t.crashCart.saveWithMissing}
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4 mb-4 text-center text-green-400">
          <CheckCircle2 className="h-8 w-8 mx-auto mb-2" />
          <p className="font-semibold">{t.crashCart.checkSaved}</p>
        </div>
      )}

      {/* Recent history */}
      {recentChecks.length > 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <h2 className="text-sm font-semibold text-zinc-400 mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4" /> {t.crashCart.historyTitle}
          </h2>
          <div className="flex flex-col gap-2">
            {recentChecks.map((check) => (
              <div key={check.id} className="flex justify-between items-center text-xs text-zinc-400">
                <span>{formatDateByLocale(check.performedAt, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                <span className="text-zinc-500">{check.performedByName}</span>
                <span className={check.allPassed ? "text-green-400" : "text-red-400"}>
                  {check.allPassed ? t.crashCart.statusOk : t.crashCart.statusMissing}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {isAdmin && (
        <CrashCartAdminSheet open={adminSheetOpen} onOpenChange={setAdminSheetOpen} />
      )}
    </div>
  );
}
