import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Helmet } from "react-helmet-async";
import { Link } from "wouter";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorCard } from "@/components/ui/error-card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ManagementAccessDenied } from "@/desktop/management";
import {
  BucketCountsSummary,
  DRIFT_BUCKET_ORDER,
  DriftBucketSection,
} from "@/features/equipment/reconciliation/ReconciliationWorklist";
import { t } from "@/lib/i18n";
import type { AssetType, DockingReconciliationItem, Equipment, Room } from "@/types";

const EQUIPMENT_QUERY_KEY = ["/api/equipment"];
const ROOMS_QUERY_KEY = ["/api/rooms"];
const ASSET_TYPES_QUERY_KEY = ["/api/asset-types"];
const RECONCILIATION_QUERY_KEY = ["/api/docking/reconciliation"];

export default function AdminHomeAssignmentPage() {
  const { role } = useAuth();
  // Mirrors AdminDocksPage/AdminAssetTypesPage: explicit denial screen, not a blank return.
  if (role !== "admin") {
    return (
      <AppShell>
        <ManagementAccessDenied />
      </AppShell>
    );
  }

  return <AdminHomeAssignmentContent />;
}

function AdminHomeAssignmentContent() {
  const queryClient = useQueryClient();
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [homeRoomId, setHomeRoomId] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const equipmentQ = useQuery({ queryKey: EQUIPMENT_QUERY_KEY, queryFn: api.equipment.list });
  const roomsQ = useQuery({ queryKey: ROOMS_QUERY_KEY, queryFn: api.rooms.list });
  const assetTypesQ = useQuery({ queryKey: ASSET_TYPES_QUERY_KEY, queryFn: api.operationalState.listAssetTypes });
  const reconciliationQ = useQuery({ queryKey: RECONCILIATION_QUERY_KEY, queryFn: api.docking.reconciliation });

  const assignMut = useMutation({
    mutationFn: (data: { ids: string[]; homeRoomId: string; assetTypeId?: string }) =>
      api.docking.assignHomeBulk({
        ids: data.ids,
        homeRoomId: data.homeRoomId,
        ...(data.assetTypeId ? { assetTypeId: data.assetTypeId } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: EQUIPMENT_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: RECONCILIATION_QUERY_KEY });
      setSelectedIds(new Set());
      toast.success(t.adminHomeAssignment.assignSuccess);
    },
    onError: (error: ApiError) => {
      toast.error(error.message || t.adminHomeAssignment.assignError);
    },
  });

  const filteredEquipment = useMemo(() => {
    const items = equipmentQ.data ?? [];
    if (!categoryFilter) return items;
    return items.filter((item) => item.assetTypeId === categoryFilter || item.assetTypeId === null);
  }, [equipmentQ.data, categoryFilter]);

  // categoryFilter changes (or an equipment refetch) can drop items from the
  // visible list; prune selectedIds to what's still visible so a bulk assign
  // never silently recategorizes an item the admin can no longer see.
  useEffect(() => {
    setSelectedIds((prev) => {
      const validIds = new Set(filteredEquipment.map((item) => item.id));
      const next = new Set([...prev].filter((id) => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [filteredEquipment]);

  const toggleSelected = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleBulkAssign = () => {
    if (!homeRoomId || selectedIds.size === 0) return;
    assignMut.mutate({
      ids: Array.from(selectedIds),
      homeRoomId,
      ...(categoryFilter ? { assetTypeId: categoryFilter } : {}),
    });
  };

  // One-tap resolution: reuses the Home Room picker already selected above,
  // so a manager sets the room once and clears every unassigned row with a
  // single click each — no per-row picker.
  const handleOneTapAssign = (item: DockingReconciliationItem) => {
    if (!homeRoomId) {
      toast.error(t.adminHomeAssignment.pickRoomFirst);
      return;
    }
    assignMut.mutate({ ids: [item.id], homeRoomId });
  };

  // Categories are an optional enhancement on this page (home-room assignment
  // still works without them) — degrade to a visible notice instead of
  // blanking the whole page when the asset-types endpoint isn't deployed yet.
  const categoriesUnavailable = assetTypesQ.error instanceof ApiError && assetTypesQ.error.status === 501;

  return (
    <AppShell title={t.adminHomeAssignment.title}>
      <Helmet>
        <title>{t.adminHomeAssignment.title}</title>
      </Helmet>
      <div className="mx-auto max-w-3xl space-y-6 p-4">
        <BucketCountsSummary
          counts={reconciliationQ.data?.counts}
          isLoading={reconciliationQ.isLoading}
        />

        <Card>
          <CardHeader>
            <CardTitle>{t.adminHomeAssignment.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="home-assignment-category" className="text-sm font-medium">
                  {t.adminHomeAssignment.categoryLabel}
                </label>
                {categoriesUnavailable ? (
                  <p className="text-sm text-muted-foreground" data-testid="home-assignment-category-unavailable">
                    {t.adminHomeAssignment.categoryUnavailable}
                  </p>
                ) : assetTypesQ.isLoading ? (
                  <Skeleton className="h-10 w-full" />
                ) : assetTypesQ.isError ? (
                  <ErrorCard
                    message={t.adminHomeAssignment.categoryLoadError}
                    onRetry={() => assetTypesQ.refetch()}
                  />
                ) : (
                  <Select
                    value={categoryFilter || "__all__"}
                    onValueChange={(v) => setCategoryFilter(v === "__all__" ? "" : v)}
                  >
                    <SelectTrigger id="home-assignment-category" data-testid="home-assignment-category-select">
                      <SelectValue placeholder={t.adminHomeAssignment.categoryPlaceholder} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">{t.adminHomeAssignment.allCategories}</SelectItem>
                      {(assetTypesQ.data ?? []).map((assetType: AssetType) => (
                        <SelectItem key={assetType.id} value={assetType.id}>
                          {assetType.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="space-y-1.5">
                <label htmlFor="home-assignment-room" className="text-sm font-medium">
                  {t.adminHomeAssignment.homeRoomLabel}
                </label>
                {roomsQ.isLoading ? (
                  <Skeleton className="h-10 w-full" />
                ) : roomsQ.isError ? (
                  <ErrorCard
                    message={t.adminHomeAssignment.roomsLoadError}
                    onRetry={() => roomsQ.refetch()}
                  />
                ) : (
                  <Select
                    value={homeRoomId || "__none__"}
                    onValueChange={(v) => setHomeRoomId(v === "__none__" ? "" : v)}
                  >
                    <SelectTrigger id="home-assignment-room" data-testid="home-assignment-room-select">
                      <SelectValue placeholder={t.adminHomeAssignment.homeRoomPlaceholder} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">{t.adminHomeAssignment.homeRoomPlaceholder}</SelectItem>
                      {(roomsQ.data ?? []).map((room: Room) => (
                        <SelectItem key={room.id} value={room.id}>
                          {room.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>

            {equipmentQ.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <ul className="space-y-1.5" aria-label={t.adminHomeAssignment.equipmentListLabel}>
                {filteredEquipment.map((item: Equipment) => (
                  <li key={item.id} className="flex items-center gap-2 px-3 py-2 border rounded text-sm">
                    <Checkbox
                      aria-label={item.name}
                      checked={selectedIds.has(item.id)}
                      onCheckedChange={(checked) => toggleSelected(item.id, checked)}
                    />
                    <span className="flex-1 min-w-0 truncate">{item.name}</span>
                  </li>
                ))}
                {filteredEquipment.length === 0 && (
                  <li className="text-sm text-muted-foreground">{t.adminHomeAssignment.noEquipment}</li>
                )}
              </ul>
            )}

            <Button
              data-testid="btn-assign-home-bulk"
              onClick={handleBulkAssign}
              disabled={selectedIds.size === 0 || !homeRoomId || assignMut.isPending}
              className="w-full"
            >
              {t.adminHomeAssignment.assignBulkButton}
            </Button>
          </CardContent>
        </Card>

        <ReconciliationSection
          title={t.adminHomeAssignment.unassignedTitle}
          hint={t.adminHomeAssignment.unassignedHint}
          items={reconciliationQ.data?.unassigned ?? []}
          emptyLabel={t.adminHomeAssignment.noUnassigned}
          isLoading={reconciliationQ.isLoading}
          isError={reconciliationQ.isError}
          onRetry={() => reconciliationQ.refetch()}
          renderAction={(item) =>
            item.assetTypeId === null ? (
              <div className="flex flex-col items-end gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  data-testid={`btn-assign-home-${item.id}`}
                  disabled
                >
                  {t.adminHomeAssignment.oneTapAssignButton}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {t.adminHomeAssignment.needsCategoryHint}
                </span>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                data-testid={`btn-assign-home-${item.id}`}
                onClick={() => handleOneTapAssign(item)}
                disabled={assignMut.isPending}
              >
                {t.adminHomeAssignment.oneTapAssignButton}
              </Button>
            )
          }
        />

        <ReconciliationSection
          title={t.adminHomeAssignment.noStationTitle}
          hint={t.adminHomeAssignment.noStationHint}
          items={reconciliationQ.data?.noStation ?? []}
          emptyLabel={t.adminHomeAssignment.noNoStation}
          isLoading={reconciliationQ.isLoading}
          isError={reconciliationQ.isError}
          onRetry={() => reconciliationQ.refetch()}
          renderAction={() => (
            <Link href="/admin/docks" className="text-sm text-primary underline">
              {t.adminHomeAssignment.manageDocksLink}
            </Link>
          )}
        />

        {DRIFT_BUCKET_ORDER.map((bucket) => (
          <DriftBucketSection
            key={bucket}
            bucket={bucket}
            items={reconciliationQ.data?.byBucket?.[bucket] ?? []}
            isLoading={reconciliationQ.isLoading}
            isError={reconciliationQ.isError}
            onRetry={() => reconciliationQ.refetch()}
          />
        ))}
      </div>
    </AppShell>
  );
}

function ReconciliationSection({
  title,
  hint,
  items,
  emptyLabel,
  isLoading,
  isError,
  onRetry,
  renderAction,
}: {
  title: string;
  hint: string;
  items: DockingReconciliationItem[];
  emptyLabel: string;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  renderAction: (item: DockingReconciliationItem) => ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : isError ? (
          <ErrorCard message={t.adminHomeAssignment.reconciliationLoadError} onRetry={onRetry} />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-2 px-3 py-2 border rounded text-sm"
            >
              <span className="flex-1 min-w-0 truncate">{item.name}</span>
              {renderAction(item)}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
