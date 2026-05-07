import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { t, formatDateByLocale } from "@/lib/i18n";

export default function AdminMedicationIntegrityPage() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const q = useQuery({
    queryKey: ["/api/admin/medication-integrity"],
    queryFn: api.adminMedicationIntegrity.list,
    enabled: isAdmin,
  });

  if (!isAdmin) {
    return (
      <Layout title={t.adminMedicationIntegrity.title}>
        <p className="text-sm text-muted-foreground">{t.adminMedicationIntegrity.accessDenied}</p>
      </Layout>
    );
  }

  return (
    <Layout title={t.adminMedicationIntegrity.title}>
      <Helmet>
        <title>{t.adminMedicationIntegrity.title}</title>
      </Helmet>
      <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-bold">{t.adminMedicationIntegrity.title}</h1>
            <p className="text-sm text-muted-foreground">{t.adminMedicationIntegrity.subtitle}</p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t.adminMedicationIntegrity.title}</CardTitle>
              <CardDescription>{t.adminMedicationIntegrity.subtitle}</CardDescription>
            </CardHeader>
            <CardContent>
              {q.isLoading ? (
                <Skeleton className="h-40 w-full rounded-lg" />
              ) : q.isError ? (
                <p className="text-sm text-destructive">{(q.error as Error)?.message ?? "Error"}</p>
              ) : !q.data?.rows?.length ? (
                <p className="text-sm text-muted-foreground">{t.adminMedicationIntegrity.empty}</p>
              ) : (
                <div className="divide-y rounded-md border">
                  <div className="hidden gap-2 bg-muted/40 px-3 py-2 text-xs font-medium md:grid md:grid-cols-[1.2fr_1fr_1fr_1fr_auto]">
                    <span>{t.adminMedicationIntegrity.colTime}</span>
                    <span>{t.adminMedicationIntegrity.colPatient}</span>
                    <span>{t.adminMedicationIntegrity.colContainer}</span>
                    <span>{t.adminMedicationIntegrity.colBilling}</span>
                    <span className="text-end">{t.adminMedicationIntegrity.colFlags}</span>
                  </div>
                  {q.data.rows.map((r) => (
                    <div
                      key={r.inventoryLogId}
                      className="grid gap-2 px-3 py-3 text-sm md:grid-cols-[1.2fr_1fr_1fr_1fr_auto] md:items-center"
                    >
                      <span className="whitespace-nowrap text-xs">
                        {formatDateByLocale(new Date(r.createdAt), {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </span>
                      <span>{r.animalName ?? r.animalId ?? "—"}</span>
                      <span className="font-mono text-xs">{r.containerId.slice(0, 8)}…</span>
                      <span className="text-xs">
                        {r.billingTotalCents != null ? (
                          <>
                            ₪{(r.billingTotalCents / 100).toFixed(2)}{" "}
                            <span className="text-muted-foreground">({r.billingStatus})</span>
                          </>
                        ) : (
                          "—"
                        )}
                      </span>
                      <span className="text-end">
                        {r.discrepancyFlags?.includes("NO_ACTIVE_HOSPITALIZATION") ? (
                          <Badge variant="destructive">{t.adminMedicationIntegrity.flagNoHosp}</Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
    </Layout>
  );
}
