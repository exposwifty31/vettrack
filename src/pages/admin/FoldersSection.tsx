import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { FolderOpen, Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useConfirm } from "@/hooks/use-confirm";
import { t } from "@/lib/i18n";

export function FoldersSection() {
  const confirm = useConfirm();
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editFolder, setEditFolder] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [folderName, setFolderName] = useState("");

  const { data: folders, isLoading } = useQuery({
    queryKey: ["/api/folders"],
    queryFn: api.folders.list,
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const createMut = useMutation({
    mutationFn: (name: string) => api.folders.create(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/folders"] });
      setCreateOpen(false);
      setFolderName("");
      toast.success(t.adminPage.folderCreated);
    },
    onError: () => toast.error(t.adminPage.folderCreateFailed),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.folders.update(id, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/folders"] });
      setEditFolder(null);
      setFolderName("");
      toast.success(t.adminPage.folderUpdated);
    },
    onError: () => toast.error(t.adminPage.folderUpdateFailed),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.folders.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/folders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      toast.success(t.adminPage.folderDeleted);
    },
    onError: () => toast.error(t.adminPage.folderDeleteFailed),
  });

  const manualFolders = folders?.filter((f) => f.type !== "smart") || [];

  const isSaving = createMut.isPending || updateMut.isPending;

  const submit = () => {
    const trimmedName = folderName.trim();
    if (!trimmedName || isSaving) return;
    if (editFolder) {
      updateMut.mutate({ id: editFolder.id, name: trimmedName });
    } else {
      createMut.mutate(trimmedName);
    }
  };

  return (
    <Card className="bg-card border-border/60 shadow-sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-muted-foreground" />
            {t.adminPage.foldersTitle}
          </CardTitle>
          <Button
            size="sm"
            className="h-11 text-xs"
            onClick={() => {
              setFolderName("");
              setCreateOpen(true);
            }}
            data-testid="btn-create-folder"
          >
            <Plus className="w-4 h-4 me-1" />
            {t.adminPage.folderNew}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex flex-col gap-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {manualFolders.map((f) => (
              <div
                key={f.id}
                className="flex items-center justify-between p-3 bg-muted/50 rounded-xl border"
              >
                <div className="flex items-center gap-2">
                  <FolderOpen className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{f.name}</span>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${t.adminPage.editFolder} — ${f.name}`}
                    onClick={() => {
                      setEditFolder(f);
                      setFolderName(f.name);
                    }}
                    data-testid={`btn-edit-folder-${f.id}`}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${t.common.delete} — ${f.name}`}
                    className="text-destructive hover:text-destructive h-11 w-11"
                    data-testid={`btn-delete-folder-${f.id}`}
                    onClick={async () => {
                      if (
                        !(await confirm({
                          title: t.adminPage.deleteFolderTitle(f.name),
                          description: t.adminPage.deleteFolderBody,
                          confirmLabel: t.adminPage.deleteFolderConfirm,
                          destructive: true,
                        }))
                      ) {
                        return;
                      }
                      deleteMut.mutate(f.id);
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}

            {manualFolders.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                {t.adminPage.noFoldersYet}
              </p>
            )}
          </div>
        )}
      </CardContent>

      {/* Create / Edit folder dialog */}
      <Dialog
        open={createOpen || !!editFolder}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setEditFolder(null);
            setFolderName("");
          }
        }}
      >
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>
              {editFolder ? t.adminPage.editFolder : t.adminPage.createFolder}
            </DialogTitle>
            <DialogDescription className="sr-only">{t.adminPage.folderDialogDescription}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-1">
            <Label htmlFor="folderName">{t.adminPage.folderName}</Label>
            <Input
              id="folderName"
              placeholder={t.adminPage.folderNamePlaceholder}
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  submit();
                }
              }}
              data-testid="input-folder-name"
            />
          </div>
          <DialogFooter>
            <Button
              onClick={submit}
              disabled={!folderName.trim() || isSaving}
              data-testid="btn-save-folder"
            >
              {isSaving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
              {editFolder ? t.adminPage.update : t.adminPage.create}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
