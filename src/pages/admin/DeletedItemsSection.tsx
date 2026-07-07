import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Bdi } from "@/components/ui/bdi";
import { TruncatedText } from "@/components/ui/truncated-text";
import { Wrench, Users, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import type { User, DeletedEquipment } from "@/types";
import { t, formatDateByLocale } from "@/lib/i18n";
import { haptics } from "@/lib/haptics";

export function DeletedItemsSection() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();

  const { data: deletedEquipment, isLoading: equipLoading } = useQuery({
    queryKey: ["/api/equipment/deleted"],
    queryFn: api.equipment.listDeleted,
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const { data: deletedUsers, isLoading: usersLoading } = useQuery({
    queryKey: ["/api/users/deleted"],
    queryFn: api.users.listDeleted,
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const restoreEquipMut = useMutation({
    mutationFn: (id: string) => api.equipment.restore(id),
    onSuccess: () => {
      haptics.tap();
      queryClient.invalidateQueries({ queryKey: ["/api/equipment/deleted"] });
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      toast.success(t.adminPage.equipmentRestored);
    },
    onError: () => toast.error(t.adminPage.equipmentRestoreFailed),
  });

  const restoreUserMut = useMutation({
    mutationFn: (id: string) => api.users.restore(id),
    onSuccess: () => {
      haptics.tap();
      queryClient.invalidateQueries({ queryKey: ["/api/users/deleted"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast.success(t.adminPage.userRestored);
    },
    onError: () => toast.error(t.adminPage.userRestoreFailed),
  });

  return (
    <div className="flex flex-col gap-4">
      <Card className="bg-card border-border/60 shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Wrench className="w-4 h-4 text-muted-foreground" />
            {t.adminPage.deletedEquipmentTitle}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {equipLoading ? (
            <div className="flex flex-col gap-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 rounded-xl" />
              ))}
            </div>
          ) : !deletedEquipment || deletedEquipment.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              {t.adminPage.noDeletedEquipment}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {deletedEquipment.map((item: DeletedEquipment) => (
                <div
                  key={item.id}
                  data-testid={`deleted-equipment-row-${item.id}`}
                  className="flex items-center justify-between p-3 bg-card rounded-xl border border-border gap-3 hover:bg-muted/50 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <Bdi>
                      <TruncatedText text={item.name} className="text-sm font-medium" as="p" />
                    </Bdi>
                    {(item.model || item.serialNumber) && (
                      <TruncatedText
                        text={[item.model, item.serialNumber].filter(Boolean).join(" · ")}
                        className="text-xs text-muted-foreground"
                        as="p"
                      />
                    )}
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t.adminPage.deletedOn(formatDateByLocale(item.deletedAt))}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 gap-1 h-11 text-xs"
                    disabled={restoreEquipMut.isPending}
                    data-testid={`btn-restore-equipment-${item.id}`}
                    onClick={() => restoreEquipMut.mutate(item.id)}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    {t.adminPage.restore}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Deleted users */}
      <Card className="bg-card border-border/60 shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Users className="w-4 h-4 text-muted-foreground" />
            {t.adminPage.deletedUsersTitle}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {usersLoading ? (
            <div className="flex flex-col gap-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 rounded-xl" />
              ))}
            </div>
          ) : !deletedUsers || deletedUsers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              {t.adminPage.noDeletedUsers}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {deletedUsers.map((user: User) => (
                <div
                  key={user.id}
                  data-testid={`deleted-user-row-${user.id}`}
                  className="flex items-center justify-between p-3 bg-card rounded-xl border border-border gap-3 hover:bg-muted/50 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <Bdi>
                      <TruncatedText
                        text={user.displayName || user.name || user.email}
                        className="text-sm font-medium"
                        as="p"
                      />
                    </Bdi>
                    <Bdi dir="ltr">
                      <TruncatedText text={user.email} className="text-xs text-muted-foreground" as="p" />
                    </Bdi>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {user.deletedAt
                        ? t.adminPage.deletedOn(formatDateByLocale(user.deletedAt))
                        : "—"}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 gap-1 h-11 text-xs"
                    disabled={restoreUserMut.isPending}
                    data-testid={`btn-restore-user-${user.id}`}
                    onClick={() => restoreUserMut.mutate(user.id)}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    {t.adminPage.restore}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
