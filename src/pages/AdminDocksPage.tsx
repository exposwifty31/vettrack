import { useState } from "react";
import { t } from "@/lib/i18n";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ManagementAccessDenied } from "@/desktop/management";
import type { AssetType, Dock, Room } from "@/types";

export default function AdminDocksPage() {
  const { role } = useAuth();
  // T22: was a blank `return null` — no explicit signal a non-admin was denied.
  if (role !== "admin") {
    return (
      <AppShell>
        <ManagementAccessDenied />
      </AppShell>
    );
  }

  return <AdminDocksContent />;
}

function AdminDocksContent() {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newRoomId, setNewRoomId] = useState<string>("");
  const [newAssetTypeId, setNewAssetTypeId] = useState<string>("");
  const [newCapacity, setNewCapacity] = useState<string>("");

  const docksQ = useQuery({
    queryKey: ["/api/docks"],
    queryFn: api.operationalState.listDocks,
  });

  const roomsQ = useQuery({
    queryKey: ["/api/rooms"],
    queryFn: api.rooms.list,
  });

  const assetTypesQ = useQuery({
    queryKey: ["/api/asset-types"],
    queryFn: api.operationalState.listAssetTypes,
  });

  const createMut = useMutation({
    mutationFn: () => {
      const capacity = newCapacity.trim() ? parseInt(newCapacity, 10) : undefined;
      return api.operationalState.createDock({
        name: newName.trim(),
        description: newDesc.trim() || undefined,
        roomId: newRoomId || undefined,
        assetTypeId: newAssetTypeId || undefined,
        capacity: capacity !== undefined && !Number.isNaN(capacity) ? capacity : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/docks"] });
      setNewName("");
      setNewDesc("");
      setNewRoomId("");
      setNewAssetTypeId("");
      setNewCapacity("");
      toast.success("Dock created");
    },
  });

  if (docksQ.error instanceof ApiError && docksQ.error.status === 501) return null;

  return (
    <AppShell title="Docks">
      <Helmet>
        <title>Docks</title>
      </Helmet>
      <div className="max-w-2xl mx-auto space-y-6 p-4">
        <Card>
          <CardHeader>
            <CardTitle>Docks</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="dock-name" className="sr-only">Dock name</label>
              <Input
                id="dock-name"
                placeholder={t.adminDocks.namePlaceholder}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <label htmlFor="dock-desc" className="sr-only">Description</label>
              <Input
                id="dock-desc"
                placeholder={t.adminDocks.descriptionPlaceholder}
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
              />
              <Select value={newRoomId || "__none__"} onValueChange={(v) => setNewRoomId(v === "__none__" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder={t.adminDocks.roomPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No room</SelectItem>
                  {(roomsQ.data ?? []).map((room: Room) => (
                    <SelectItem key={room.id} value={room.id}>
                      {room.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={newAssetTypeId || "__none__"}
                onValueChange={(v) => setNewAssetTypeId(v === "__none__" ? "" : v)}
              >
                <SelectTrigger data-testid="dock-category-select">
                  <SelectValue placeholder={t.adminDocks.categoryPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t.adminDocks.noCategory}</SelectItem>
                  {(assetTypesQ.data ?? []).map((assetType: AssetType) => (
                    <SelectItem key={assetType.id} value={assetType.id}>
                      {assetType.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label htmlFor="dock-capacity" className="sr-only">Capacity</label>
              <Input
                id="dock-capacity"
                data-testid="dock-capacity-input"
                type="number"
                min={1}
                placeholder={t.adminDocks.capacityPlaceholder}
                value={newCapacity}
                onChange={(e) => setNewCapacity(e.target.value)}
              />
              <Button
                data-testid="btn-add-dock"
                onClick={() => createMut.mutate()}
                disabled={!newName.trim() || createMut.isPending}
                className="w-full"
              >
                Add Dock
              </Button>
            </div>
            {docksQ.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <div className="space-y-1.5">
                {(docksQ.data ?? []).map((dock: Dock) => {
                  const metaParts = [
                    dock.roomName,
                    dock.assetTypeName,
                    dock.capacity != null ? `${t.adminDocks.capacityLabel} ${dock.capacity}` : null,
                  ].filter(Boolean);
                  return (
                    <div key={dock.id} className="flex items-center gap-2 px-3 py-2 border rounded text-sm">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium">{dock.name}</p>
                        {metaParts.length > 0 && (
                          <p className="text-xs text-muted-foreground">{metaParts.join(" · ")}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
