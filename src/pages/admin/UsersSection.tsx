import { useState, useMemo } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Bdi } from "@/components/ui/bdi";
import { TruncatedText } from "@/components/ui/truncated-text";
import { EmptyState } from "@/components/ui/empty-state";
import { Users, XCircle, CheckCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useConfirm } from "@/hooks/use-confirm";
import { cn } from "@/lib/utils";
import type { User } from "@/types";
import { t, formatDateByLocale } from "@/lib/i18n";
import { haptics } from "@/lib/haptics";

type UserRole = "admin" | "vet" | "technician" | "senior_technician" | "student";

const ROLE_BADGE_STYLES: Record<UserRole, string> = {
  admin: "bg-primary/10 text-primary border border-primary/30",
  vet: "bg-[rgb(var(--sys-blue)/0.12)] text-[rgb(var(--sys-blue))] border border-[rgb(var(--sys-blue)/0.22)]",
  technician: "bg-muted text-muted-foreground border border-border",
  senior_technician: "bg-status-ok/10 text-status-ok border border-status-ok/25",
  student: "bg-muted text-muted-foreground border border-border",
};

const ROLE_LABELS: Record<UserRole, string> = {
  admin: t.adminPage.roleAdmin,
  vet: t.adminPage.roleVet,
  technician: t.adminPage.roleTechnician,
  senior_technician: t.adminPage.roleSeniorTechnician,
  student: t.adminPage.roleStudent,
};

function RoleBadge({ role }: { role: string }) {
  const r = role as UserRole;
  const style =
    ROLE_BADGE_STYLES[r] ?? "bg-muted text-muted-foreground border border-border";
  const label = ROLE_LABELS[r] ?? role;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${style}`}
    >
      {label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "active") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border bg-[var(--status-ok-bg)] text-[var(--status-ok-fg)] border-[var(--status-ok-border)]">
        {t.adminPage.filterActive}
      </span>
    );
  }
  if (status === "blocked") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border bg-[var(--status-issue-bg)] text-[var(--status-issue-fg)] border-[var(--status-issue-border)]">
        {t.adminPage.filterBlocked}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border bg-[var(--status-stale-bg)] text-[var(--status-stale-fg)] border-[var(--status-stale-border)]">
      {t.adminPage.filterPending}
    </span>
  );
}

type UserStatusFilter = "all" | "pending" | "active" | "blocked";

export function UsersSection() {
  const confirm = useConfirm();
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<UserStatusFilter>("all");
  const effectiveStatus = statusFilter === "all" ? undefined : statusFilter;
  const [pendingRoleChange, setPendingRoleChange] = useState<{
    user: User;
    newRole: UserRole;
  } | null>(null);
  const [pendingSecondaryRole, setPendingSecondaryRole] = useState<string | null | undefined>(undefined);
  const [pendingSecondaryRoleUserId, setPendingSecondaryRoleUserId] = useState<string | null>(null);
  const [pendingStatusChange, setPendingStatusChange] = useState<{
    user: User;
    newStatus: "pending" | "active" | "blocked";
  } | null>(null);

  const {
    data: usersPages,
    isLoading,
    fetchNextPage: fetchMoreUsers,
    hasNextPage: hasMoreUsers,
    isFetchingNextPage: isFetchingMoreUsers,
  } = useInfiniteQuery({
    queryKey: ["/api/users", effectiveStatus ?? "all"],
    queryFn: ({ pageParam = 1 }) =>
      api.users.listPaginated(pageParam as number, 100, effectiveStatus),
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    initialPageParam: 1,
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const users = useMemo(
    () => usersPages?.pages.flatMap((p) => p.items),
    [usersPages]
  );

  const updateRoleMut = useMutation({
    mutationFn: ({ id, role }: { id: string; role: UserRole }) =>
      api.users.updateRole(id, role),
    onSuccess: () => {
      haptics.tap();
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setPendingRoleChange(null);
      toast.success(t.adminPage.roleUpdated);
    },
    onError: () => toast.error(t.adminPage.roleUpdateFailed),
  });

  const updateSecondaryRoleMut = useMutation({
    mutationFn: ({ id, secondaryRole }: { id: string; secondaryRole: string | null }) =>
      api.users.updateSecondaryRole(id, secondaryRole),
    onSuccess: () => {
      haptics.tap();
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setPendingSecondaryRole(undefined);
      setPendingSecondaryRoleUserId(null);
      toast.success(t.adminPage.secondaryRoleUpdated);
    },
    onError: () => {
      // Roll back the optimistic Select value so it falls back to the persisted role.
      setPendingSecondaryRole(undefined);
      setPendingSecondaryRoleUserId(null);
      toast.error(t.adminPage.secondaryRoleUpdateFailed);
    },
  });

  const updateStatusMut = useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string;
      status: "pending" | "active" | "blocked";
    }) => api.users.updateStatus(id, status),
    onSuccess: (_, { status }) => {
      haptics.tap();
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users/pending"] });
      toast.success(
        status === "active"
          ? t.adminPage.userApproved
          : status === "blocked"
            ? t.adminPage.userRejected
            : t.adminPage.statusUpdated,
      );
    },
    onError: () => toast.error(t.adminPage.statusUpdateFailed),
  });

  const setEquipmentCoordinatorMut = useMutation({
    mutationFn: ({ id, isEquipmentCoordinator }: { id: string; isEquipmentCoordinator: boolean }) =>
      api.users.setEquipmentCoordinator(id, isEquipmentCoordinator),
    onSuccess: () => {
      haptics.tap();
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast.success(t.adminPage.equipmentCoordinatorUpdated);
    },
    onError: () => toast.error(t.adminPage.equipmentCoordinatorUpdateFailed),
  });

  const deleteUserMut = useMutation({
    mutationFn: (id: string) => api.users.delete(id),
    onSuccess: () => {
      haptics.tap();
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users/deleted"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users/pending"] });
      toast.success(t.adminPage.userDeleted);
    },
    onError: () => toast.error(t.adminPage.userDeleteFailed),
  });

  const restoreUserMut = useMutation({
    mutationFn: (id: string) => api.users.restore(id),
    onSuccess: () => {
      haptics.tap();
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users/deleted"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users/pending"] });
      toast.success(t.adminPage.userRestored);
    },
    onError: () => toast.error(t.adminPage.userRestoreFailed),
  });

  const filterButtons: { label: string; value: UserStatusFilter }[] = [
    { label: t.adminPage.filterAll, value: "all" },
    { label: t.adminPage.filterPending, value: "pending" },
    { label: t.adminPage.filterActive, value: "active" },
    { label: t.adminPage.filterBlocked, value: "blocked" },
  ];

  return (
    <Card className="bg-card border-border/60 shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Users className="w-4 h-4 text-muted-foreground" />
          {t.adminPage.usersTitle}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Status filter tabs */}
        <div className="flex gap-1.5 mb-4 flex-wrap">
          {filterButtons.map(({ label, value }) => (
            <button
              key={value}
              onClick={() => setStatusFilter(value)}
              data-testid={`filter-users-${value}`}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                statusFilter === value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/50 text-muted-foreground border-border hover:bg-muted",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        ) : !users || users.length === 0 ? (
          <EmptyState
            icon={Users}
            message={
              statusFilter === "all"
                ? t.adminPage.noUsersYet
                : t.adminPage.noMatchingUsers
            }
            subMessage={
              statusFilter === "all"
                ? t.adminPage.firstLoginUsersHint
                : t.adminPage.tryOtherFilterHint
            }
          />
        ) : (
          <div className="flex flex-col gap-2">
            {(users ?? []).map((user) => (
              <div
                key={user.id}
                data-testid={`user-row-${user.id}`}
                className="flex items-start justify-between p-3 bg-card rounded-xl border border-border gap-3 hover:bg-muted/50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <Bdi className="min-w-0 flex-1">
                      <TruncatedText
                        text={user.displayName || user.name || user.email}
                        className="text-sm font-medium"
                        as="p"
                      />
                    </Bdi>
                    <RoleBadge role={user.role} />
                    {user.secondaryRole && (
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border border-border bg-muted text-muted-foreground"
                        title={t.adminPage.secondaryRoleTooltip}
                      >
                        +{ROLE_LABELS[user.secondaryRole as UserRole] ?? user.secondaryRole}
                      </span>
                    )}
                    <StatusBadge status={user.status} />
                  </div>
                  <Bdi dir="ltr">
                    <TruncatedText text={user.email} className="text-xs text-muted-foreground" as="p" />
                  </Bdi>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t.adminPage.joined(formatDateByLocale(user.createdAt))}
                  </p>
                  {(user.role === "technician" || user.role === "senior_technician") && (
                    <label
                      className="flex items-center gap-2 text-xs text-muted-foreground mt-2"
                      data-testid={`equipment-coordinator-row-${user.id}`}
                    >
                      <Checkbox
                        checked={!!user.isEquipmentCoordinator}
                        onCheckedChange={(checked) =>
                          setEquipmentCoordinatorMut.mutate({ id: user.id, isEquipmentCoordinator: checked })
                        }
                        disabled={setEquipmentCoordinatorMut.isPending}
                        data-testid={`checkbox-equipment-coordinator-${user.id}`}
                      />
                      {t.adminPage.equipmentCoordinatorLabel}
                    </label>
                  )}
                  {user.status === "pending" && (
                    <div className="flex gap-2 mt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive h-11 px-2 text-xs"
                        disabled={updateStatusMut.isPending}
                        data-testid={`btn-reject-user-${user.id}`}
                        onClick={async () => {
                          if (
                            !(await confirm({
                              title: t.adminPage.rejectUserTitle(user.displayName || user.name || user.email || ""),
                              description: t.adminPage.rejectUserBody,
                              confirmLabel: t.adminPage.rejectUserConfirm,
                              destructive: true,
                            }))
                          ) {
                            return;
                          }
                          updateStatusMut.mutate({ id: user.id, status: "blocked" });
                        }}
                      >
                        <XCircle className="w-3 h-3 me-1" />
                        {t.adminPage.reject}
                      </Button>
                      <Button
                        size="sm"
                        className="bg-[var(--status-ok-fg)] hover:opacity-90 text-white h-11 px-2 text-xs"
                        onClick={() =>
                          updateStatusMut.mutate({
                            id: user.id,
                            status: "active",
                          })
                        }
                        disabled={updateStatusMut.isPending}
                        data-testid={`btn-approve-user-${user.id}`}
                      >
                        <CheckCircle className="w-3 h-3 me-1" />
                        {t.adminPage.approve}
                      </Button>
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1.5 shrink-0">
                  <div className="flex gap-1.5 justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-2 text-xs"
                      data-testid={`btn-soft-delete-user-${user.id}`}
                      disabled={deleteUserMut.isPending || Boolean(user.deletedAt)}
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (
                          !(await confirm({
                            title: t.adminPage.deleteUserTitle(user.displayName || user.name || user.email || ""),
                            description: t.adminPage.deleteUserBody,
                            confirmLabel: t.adminPage.deleteUserConfirm,
                            destructive: true,
                          }))
                        ) {
                          return;
                        }
                        deleteUserMut.mutate(user.id);
                      }}
                    >
                      {t.adminPage.deleteUser}
                    </Button>
                    {user.deletedAt ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 px-2 text-xs"
                        data-testid={`btn-restore-user-inline-${user.id}`}
                        disabled={restoreUserMut.isPending}
                        onClick={(e) => {
                          e.stopPropagation();
                          restoreUserMut.mutate(user.id);
                        }}
                      >
                        {t.adminPage.restoreUser}
                      </Button>
                    ) : null}
                  </div>
                  <Select
                    value={user.role}
                    onValueChange={(role) => {
                      setPendingRoleChange({ user, newRole: role as UserRole });
                    }}
                  >
                    <SelectTrigger
                      className="w-32 h-8 text-xs"
                      data-testid={`select-role-${user.id}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">{t.adminPage.roleAdmin}</SelectItem>
                      <SelectItem value="vet">{t.adminPage.roleVet}</SelectItem>
                      <SelectItem value="technician">{t.adminPage.roleTechnician}</SelectItem>
                      <SelectItem value="senior_technician">{t.adminPage.roleSeniorTechnician}</SelectItem>
                      <SelectItem value="student">{t.adminPage.roleStudent}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={
                      pendingSecondaryRoleUserId === user.id && pendingSecondaryRole !== undefined
                        ? (pendingSecondaryRole ?? "none")
                        : (user.secondaryRole ?? "none")
                    }
                    onValueChange={(val) => {
                      const newVal = val === "none" ? null : val;
                      setPendingSecondaryRoleUserId(user.id);
                      setPendingSecondaryRole(newVal);
                      updateSecondaryRoleMut.mutate({ id: user.id, secondaryRole: newVal });
                    }}
                  >
                    <SelectTrigger
                      className="w-32 h-8 text-xs"
                      data-testid={`select-secondary-role-${user.id}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t.adminPage.secondaryRoleNone}</SelectItem>
                      <SelectItem value="admin">{t.adminPage.roleAdmin}</SelectItem>
                      <SelectItem value="senior_technician">{t.adminPage.roleSeniorTechnician}</SelectItem>
                      <SelectItem value="technician">{t.adminPage.roleTechnician}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={user.status}
                    onValueChange={(status) => {
                      const newStatus = status as
                        | "pending"
                        | "active"
                        | "blocked";
                      if (newStatus === "blocked") {
                        setPendingStatusChange({ user, newStatus });
                      } else {
                        updateStatusMut.mutate({
                          id: user.id,
                          status: newStatus,
                        });
                      }
                    }}
                  >
                    <SelectTrigger
                      className="w-32 h-8 text-xs"
                      data-testid={`select-status-${user.id}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">{t.adminPage.filterPending}</SelectItem>
                      <SelectItem value="active">{t.adminPage.filterActive}</SelectItem>
                      <SelectItem value="blocked">{t.adminPage.filterBlocked}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))}
            {hasMoreUsers && (
              <div className="flex justify-center pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-11 text-xs"
                  onClick={() => fetchMoreUsers()}
                  disabled={isFetchingMoreUsers}
                  data-testid="btn-load-more-users"
                >
                  {isFetchingMoreUsers ? (
                    <><Loader2 className="w-4 h-4 me-1 animate-spin" />{t.common.loading}</>
                  ) : (
                    t.adminPage.loadMore
                  )}
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>

      {/* Role change confirmation dialog */}
      <AlertDialog
        open={!!pendingRoleChange}
        onOpenChange={(open) => {
          if (!open) setPendingRoleChange(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t.adminPage.changeRoleTo}{" "}
              {ROLE_LABELS[pendingRoleChange?.newRole as UserRole] ??
                pendingRoleChange?.newRole}
              ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRoleChange?.user.displayName || pendingRoleChange?.user.name || pendingRoleChange?.user.email}
              {" · "}
              {ROLE_LABELS[pendingRoleChange?.user.role as UserRole] ?? pendingRoleChange?.user.role}
              {" → "}
              {ROLE_LABELS[pendingRoleChange?.newRole as UserRole] ?? pendingRoleChange?.newRole}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.adminPage.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingRoleChange) {
                  updateRoleMut.mutate({
                    id: pendingRoleChange.user.id,
                    role: pendingRoleChange.newRole,
                  });
                }
              }}
              disabled={updateRoleMut.isPending}
            >
              {updateRoleMut.isPending ? (
                <Loader2 className="w-4 h-4 me-1 animate-spin" />
              ) : null}
              {t.adminPage.changeRoleConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Block user confirmation dialog */}
      <AlertDialog
        open={!!pendingStatusChange}
        onOpenChange={(open) => {
          if (!open) setPendingStatusChange(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t.adminPage.blockUserTitle(
                pendingStatusChange?.user.displayName ||
                pendingStatusChange?.user.name ||
                pendingStatusChange?.user.email || ""
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t.adminPage.blockUserBody}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.adminPage.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingStatusChange) {
                  updateStatusMut.mutate({
                    id: pendingStatusChange.user.id,
                    status: pendingStatusChange.newStatus,
                  });
                  setPendingStatusChange(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={updateStatusMut.isPending}
            >
              {updateStatusMut.isPending ? (
                <Loader2 className="w-4 h-4 me-1 animate-spin" />
              ) : null}
              {t.adminPage.blockUserConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
