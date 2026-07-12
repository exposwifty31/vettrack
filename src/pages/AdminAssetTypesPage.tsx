import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Helmet } from "react-helmet-async";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ManagementAccessDenied } from "@/desktop/management";
import { t } from "@/lib/i18n";
import type { AssetType, AssetTypeCondition } from "@/types";

export default function AdminAssetTypesPage() {
  const { role } = useAuth();
  // T22: was a blank `return null` — no explicit signal a non-admin was denied.
  if (role !== "admin") {
    return (
      <AppShell>
        <ManagementAccessDenied />
      </AppShell>
    );
  }

  return <AdminAssetTypesContent />;
}

function AdminAssetTypesContent() {
  const queryClient = useQueryClient();
  const [newTypeName, setNewTypeName] = useState("");
  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null);
  const [newCondName, setNewCondName] = useState("");
  const [newCondMethod, setNewCondMethod] = useState("visual");
  const [newCondStale, setNewCondStale] = useState("60");

  const typesQ = useQuery({
    queryKey: ["/api/asset-types"],
    queryFn: api.operationalState.listAssetTypes,
  });

  const conditionsQ = useQuery({
    queryKey: ["/api/asset-types", selectedTypeId, "conditions"],
    queryFn: () => api.operationalState.listConditions(selectedTypeId!),
    enabled: !!selectedTypeId,
  });

  const createTypeMut = useMutation({
    mutationFn: () => api.operationalState.createAssetType({ name: newTypeName.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/asset-types"] });
      setNewTypeName("");
      toast.success(t.adminAssetTypesPage.assetTypeCreated);
    },
  });

  const createCondMut = useMutation({
    mutationFn: () =>
      api.operationalState.createCondition(selectedTypeId!, {
        conditionName: newCondName.trim(),
        verificationMethod: newCondMethod,
        staleAfterMinutes: parseInt(newCondStale, 10) || 60,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/asset-types", selectedTypeId, "conditions"] });
      setNewCondName("");
      toast.success(t.adminAssetTypesPage.conditionAdded);
    },
  });

  if (typesQ.error instanceof ApiError && typesQ.error.status === 501) return null;

  return (
    <AppShell title={t.operationalState.setupRequired}>
      <Helmet>
        <title>{t.adminAssetTypesPage.title}</title>
      </Helmet>
      <div className="mx-auto max-w-4xl space-y-6 p-4 md:grid md:grid-cols-[minmax(220px,300px)_1fr] md:items-start md:gap-6 md:space-y-0">
        <Card>
          <CardHeader>
            <CardTitle>{t.adminAssetTypesPage.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder={t.adminAssetTypesPage.typePlaceholder}
                value={newTypeName}
                onChange={(e) => setNewTypeName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && newTypeName.trim() && createTypeMut.mutate()}
              />
              <Button
                onClick={() => createTypeMut.mutate()}
                disabled={!newTypeName.trim() || createTypeMut.isPending}
              >
                {t.adminAssetTypesPage.addButton}
              </Button>
            </div>
            {typesQ.isLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : (typesQ.data ?? []).length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-4 py-10 text-center">
                <p className="text-base font-semibold text-foreground">{t.adminAssetTypesPage.emptyTitle}</p>
                <p className="max-w-[34ch] text-sm text-muted-foreground">{t.adminAssetTypesPage.emptySub}</p>
              </div>
            ) : (
              <div className="space-y-1">
                {(typesQ.data ?? []).map((at: AssetType) => (
                  <button
                    key={at.id}
                    onClick={() => setSelectedTypeId(at.id === selectedTypeId ? null : at.id)}
                    className={`w-full text-start px-3 py-2 rounded border text-sm transition-colors ${
                      at.id === selectedTypeId
                        ? "border-primary bg-primary/5 font-medium"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    {at.name}
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {selectedTypeId ? (
          <Card>
            <CardHeader>
              <CardTitle>{t.adminAssetTypesPage.readinessConditionsTitle}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-2">
                <Input
                  placeholder={t.adminAssetTypesPage.conditionNamePlaceholder}
                  value={newCondName}
                  onChange={(e) => setNewCondName(e.target.value)}
                  className="col-span-1"
                />
                <select
                  value={newCondMethod}
                  onChange={(e) => setNewCondMethod(e.target.value)}
                  className="border rounded px-2 text-sm"
                >
                  <option value="visual">{t.bundleConditions.verificationMethod.visual}</option>
                  <option value="electronic">{t.bundleConditions.verificationMethod.electronic}</option>
                  <option value="manual">{t.bundleConditions.verificationMethod.manual}</option>
                </select>
                <div className="flex gap-1">
                  <Input
                    type="number"
                    placeholder={t.adminAssetTypesPage.staleMinPlaceholder}
                    value={newCondStale}
                    onChange={(e) => setNewCondStale(e.target.value)}
                    className="w-24"
                  />
                  <Button
                    onClick={() => createCondMut.mutate()}
                    disabled={!newCondName.trim() || createCondMut.isPending}
                    size="sm"
                  >
                    {t.adminAssetTypesPage.addButton}
                  </Button>
                </div>
              </div>
              {conditionsQ.isLoading ? (
                <Skeleton className="h-8 w-full" />
              ) : (
                <div className="space-y-1">
                  {(conditionsQ.data ?? []).map((c: AssetTypeCondition) => (
                    <div key={c.id} className="flex items-center gap-2 px-3 py-1.5 border rounded text-sm">
                      <span className="flex-1 font-medium">{c.conditionName}</span>
                      <span className="text-xs text-muted-foreground">{c.verificationMethod}</span>
                      <span className="text-xs text-muted-foreground">{c.staleAfterMinutes}m</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="hidden md:flex md:min-h-[160px] md:items-center md:justify-center md:rounded-2xl md:border md:border-dashed md:border-border md:p-6 md:text-center">
            <p className="max-w-[34ch] text-sm text-muted-foreground">{t.adminAssetTypesPage.selectTypeHint}</p>
          </div>
        )}
      </div>
    </AppShell>
  );
}
