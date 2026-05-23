import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { t } from "@/lib/i18n";
import { formatRelativeTime } from "@/lib/utils";
import { ArrowLeft, MapPin, Printer } from "lucide-react";
import type { PilotCoverageItem } from "@/types";
import { isPilotMode } from "@/lib/pilot-mode";

const DAY_MS = 24 * 60 * 60 * 1000;

function itemStaleness(item: PilotCoverageItem): "never" | "stale" | "recent" {
  if (!item.lastSeen) return "never";
  return Date.now() - new Date(item.lastSeen).getTime() <= DAY_MS ? "recent" : "stale";
}

export default function AdminPilotCoveragePage() {
  const { isAdmin } = useAuth();
  const [, navigate] = useLocation();

  const { data, isLoading } = useQuery({
    queryKey: ["/api/equipment/pilot-coverage"],
    queryFn: api.equipment.pilotCoverage,
    enabled: isAdmin && isPilotMode,
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (!isAdmin || !isPilotMode) {
    return (
      <Layout title={t.adminPilotCoverage.title}>
        <p className="text-sm text-muted-foreground p-4">Access denied.</p>
      </Layout>
    );
  }

  const summary = data?.summary;
  const items = data?.items ?? [];

  return (
    <Layout title={t.adminPilotCoverage.title}>
      <Helmet>
        <title>{t.adminPilotCoverage.title}</title>
      </Helmet>

      <div className="flex flex-col gap-4 p-4 pb-20 max-w-2xl mx-auto">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={() => navigate("/admin")}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-xl font-semibold flex-1">{t.adminPilotCoverage.title}</h1>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 shrink-0"
            onClick={() => navigate("/admin/equipment/print-qr")}
          >
            <Printer className="w-4 h-4" />
            {t.qrPrintPage.title}
          </Button>
        </div>

        {/* Summary strip */}
        {isLoading ? (
          <div className="grid grid-cols-4 gap-2">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        ) : summary ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <SummaryCard label={t.adminPilotCoverage.total} value={summary.total} />
            <SummaryCard label={t.adminPilotCoverage.confirmedToday} value={summary.confirmedToday} accent="green" />
            <SummaryCard label={t.adminPilotCoverage.everConfirmed} value={summary.everConfirmed} />
            <SummaryCard label={t.adminPilotCoverage.neverConfirmed} value={summary.neverConfirmed} accent="red" />
          </div>
        ) : null}

        {/* Item list */}
        {isLoading ? (
          <div className="flex flex-col gap-2">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <Card className="bg-card border-border/60 shadow-sm">
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground text-sm">{t.adminPilotCoverage.noItems}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {items.map((item) => {
              const staleness = itemStaleness(item);
              return (
                <Card
                  key={item.id}
                  className="bg-card border-border/60 shadow-sm cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => navigate(`/equipment/${item.id}`)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex flex-col gap-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium truncate">{item.name}</span>
                          {staleness === "never" && (
                            <Badge variant="issue" className="text-xs shrink-0">
                              {t.adminPilotCoverage.statusNever}
                            </Badge>
                          )}
                          {staleness === "stale" && (
                            <Badge variant="maintenance" className="text-xs shrink-0">
                              {t.adminPilotCoverage.statusStale}
                            </Badge>
                          )}
                          {staleness === "recent" && (
                            <Badge variant="ok" className="text-xs shrink-0">
                              {t.adminPilotCoverage.statusRecent}
                            </Badge>
                          )}
                        </div>
                        {(item.usuallyFoundHere || item.location || item.folderName) && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <MapPin className="w-3 h-3 shrink-0" />
                            <span className="truncate">
                              {item.usuallyFoundHere ?? item.location ?? item.folderName}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0 text-right">
                        <span className="text-xs text-muted-foreground">
                          {item.lastSeen
                            ? formatRelativeTime(item.lastSeen)
                            : "—"}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {t.adminPilotCoverage.confirmCount(item.confirmCount)}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "green" | "red";
}) {
  return (
    <Card className="bg-card border-border/60 shadow-sm">
      <CardContent className="p-3 flex flex-col gap-1">
        <p className="text-xs text-muted-foreground leading-tight">{label}</p>
        <p
          className={
            accent === "green"
              ? "text-2xl font-bold text-emerald-600"
              : accent === "red"
              ? "text-2xl font-bold text-red-500"
              : "text-2xl font-bold"
          }
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
