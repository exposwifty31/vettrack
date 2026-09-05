import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
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
import { useConfirm } from "@/hooks/use-confirm";
import { haptics } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import type { User } from "@/types";
import type { UserRowActions } from "@/pages/admin/desktop/UsersTable";
import { ROLE_LABELS, type AdminUserRole, type AdminUserStatus } from "@/pages/admin/user-role-options";

export interface AdminUserActions {
  rowActions: UserRowActions;
  isMutatingUser: boolean;
  pendingSecondaryRoleUserId: string | null;
  pendingSecondaryRole: string | null | undefined;
  dialogs: ReactNode;
}

export function useAdminUserActions(): AdminUserActions {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [pendingRoleChange, setPendingRoleChange] = useState<{
    user: User;
    newRole: AdminUserRole;
  } | null>(null);
  const [pendingSecondaryRole, setPendingSecondaryRole] = useState<string | null | undefined>(undefined);
  const [pendingSecondaryRoleUserId, setPendingSecondaryRoleUserId] = useState<string | null>(null);
  const [pendingStatusChange, setPendingStatusChange] = useState<{
    user: User;
    newStatus: AdminUserStatus;
  } | null>(null);

  const updateRoleMut = useMutation({
    mutationFn: ({ id, role }: { id: string; role: AdminUserRole }) =>
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
      status: AdminUserStatus;
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

  const setSeniorDoctorEligibleMut = useMutation({
    mutationFn: ({ id, seniorDoctorEligible }: { id: string; seniorDoctorEligible: boolean }) =>
      api.users.setSeniorDoctorEligible(id, seniorDoctorEligible),
    onSuccess: () => {
      haptics.tap();
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast.success(t.adminPage.seniorDoctorEligibleUpdated);
    },
    onError: () => toast.error(t.adminPage.seniorDoctorEligibleUpdateFailed),
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

  const isMutatingUser =
    updateRoleMut.isPending ||
    updateStatusMut.isPending ||
    deleteUserMut.isPending ||
    restoreUserMut.isPending ||
    setEquipmentCoordinatorMut.isPending ||
    setSeniorDoctorEligibleMut.isPending ||
    updateSecondaryRoleMut.isPending;

  const rowActions: UserRowActions = {
    onRoleChange: (user, role) => setPendingRoleChange({ user, newRole: role }),
    onSecondaryRoleChange: (user, secondaryRole) => {
      setPendingSecondaryRoleUserId(user.id);
      setPendingSecondaryRole(secondaryRole);
      updateSecondaryRoleMut.mutate({ id: user.id, secondaryRole });
    },
    onStatusChange: (user, status) => {
      if (status === "blocked") setPendingStatusChange({ user, newStatus: status });
      else updateStatusMut.mutate({ id: user.id, status });
    },
    onToggleEquipmentCoordinator: (user, checked) =>
      setEquipmentCoordinatorMut.mutate({ id: user.id, isEquipmentCoordinator: checked }),
    onToggleSeniorDoctorEligible: (user, checked) =>
      setSeniorDoctorEligibleMut.mutate({ id: user.id, seniorDoctorEligible: checked }),
    onApprove: (user) => updateStatusMut.mutate({ id: user.id, status: "active" }),
    onReject: async (user) => {
      const ok = await confirm({
        title: t.adminPage.rejectUserTitle(user.displayName || user.name || user.email || ""),
        description: t.adminPage.rejectUserBody,
        confirmLabel: t.adminPage.rejectUserConfirm,
        destructive: true,
      });
      if (!ok) return;
      updateStatusMut.mutate({ id: user.id, status: "blocked" });
    },
    onSoftDelete: async (user) => {
      const ok = await confirm({
        title: t.adminPage.deleteUserTitle(user.displayName || user.name || user.email || ""),
        description: t.adminPage.deleteUserBody,
        confirmLabel: t.adminPage.deleteUserConfirm,
        destructive: true,
      });
      if (!ok) return;
      deleteUserMut.mutate(user.id);
    },
    onRestore: (user) => restoreUserMut.mutate(user.id),
  };

  const dialogs = (
    <>
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
              {ROLE_LABELS[pendingRoleChange?.newRole as AdminUserRole] ??
                pendingRoleChange?.newRole}
              ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRoleChange?.user.displayName || pendingRoleChange?.user.name || pendingRoleChange?.user.email}
              {" · "}
              {ROLE_LABELS[pendingRoleChange?.user.role as AdminUserRole] ?? pendingRoleChange?.user.role}
              {" → "}
              {ROLE_LABELS[pendingRoleChange?.newRole as AdminUserRole] ?? pendingRoleChange?.newRole}
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
                <Loader2 className="w-4 h-4 me-1 motion-safe:animate-spin" />
              ) : null}
              {t.adminPage.changeRoleConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                <Loader2 className="w-4 h-4 me-1 motion-safe:animate-spin" />
              ) : null}
              {t.adminPage.blockUserConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  return {
    rowActions,
    isMutatingUser,
    pendingSecondaryRoleUserId,
    pendingSecondaryRole,
    dialogs,
  };
}
