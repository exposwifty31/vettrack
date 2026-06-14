import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Helmet } from "react-helmet-async";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n";
import type { AssetType, AssetTypeCondition } from "@/types";

export default function AdminAssetTypesPage() {
  const { role } = useAuth();
  if (role !== "admin") return null;

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
      toast.success("Asset type created");
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
      toast.success("Condition added");
    },
  });

  if (typesQ.error instanceof ApiError && typesQ.error.status === 501) return null;

  return (
    <Layout title={t.operationalState.setupRequired}>
      <Helmet>
        <title>Asset Types</title>
      </Helmet>
      <div className="max-w-2xl mx-auto space-y-6 p-4">
        <Card>
          <CardHeader>
            <CardTitle>Asset Types</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Type name"
                value={newTypeName}
                onChange={(e) => setNewTypeName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && newTypeName.trim() && createTypeMut.mutate()}
              />
              <Button
                onClick={() => createTypeMut.mutate()}
                disabled={!newTypeName.trim() || createTypeMut.isPending}
              >
                Add
              </Button>
            </div>
            {typesQ.isLoading ? (
              <Skeleton className="h-10 w-full" />
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

        {selectedTypeId && (
          <Card>
            <CardHeader>
              <CardTitle>Readiness Conditions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-2">
                <Input
                  placeholder="Condition name"
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
                    placeholder="Stale (min)"
                    value={newCondStale}
                    onChange={(e) => setNewCondStale(e.target.value)}
                    className="w-24"
                  />
                  <Button
                    onClick={() => createCondMut.mutate()}
                    disabled={!newCondName.trim() || createCondMut.isPending}
                    size="sm"
                  >
                    Add
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
        )}
      </div>
    </Layout>
  );
}
