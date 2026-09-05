import { Users, XCircle, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Bdi } from "@/components/ui/bdi";
import { TruncatedText } from "@/components/ui/truncated-text";
import { t, formatDateByLocale } from "@/lib/i18n";
import type { User } from "@/types";
import type { UserRowActions } from "@/pages/admin/desktop/UsersTable";
import {
  ROLE_LABELS,
  ROLE_OPTIONS,
  SECONDARY_ROLE_OPTIONS,
  STATUS_OPTIONS,
  type AdminUserRole,
  type AdminUserStatus,
} from "@/pages/admin/user-role-options";

const ROLE_BADGE_STYLES: Record<AdminUserRole, string> = {
  admin: "bg-primary/10 text-primary border border-primary/30",
  vet: "bg-[rgb(var(--sys-blue)/0.12)] text-[rgb(var(--sys-blue))] border border-[rgb(var(--sys-blue)/0.22)]",
  technician: "bg-muted text-muted-foreground border border-border",
  senior_technician: "bg-status-ok/10 text-status-ok border border-status-ok/25",
  student: "bg-muted text-muted-foreground border border-border",
};

function RoleBadge({ role }: { role: string }) {
  const r = role as AdminUserRole;
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

interface UsersMobileListProps {
  users: User[];
  actions: UserRowActions;
  isMutating: boolean;
  pendingSecondaryRoleUserId: string | null;
  pendingSecondaryRole: string | null | undefined;
}

export function UsersMobileList({
  users,
  actions,
  isMutating,
  pendingSecondaryRoleUserId,
  pendingSecondaryRole,
}: UsersMobileListProps) {
  return (
    <div className="flex flex-col gap-2">
      {users.map((user) => (
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
              {user.secondaryRole ? (
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border border-border bg-muted text-muted-foreground"
                  title={t.adminPage.secondaryRoleTooltip}
                >
                  +{ROLE_LABELS[user.secondaryRole as AdminUserRole] ?? user.secondaryRole}
                </span>
              ) : null}
              <StatusBadge status={user.status} />
            </div>
            <Bdi dir="ltr">
              <TruncatedText text={user.email} className="text-xs text-muted-foreground" as="p" />
            </Bdi>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t.adminPage.joined(formatDateByLocale(user.createdAt))}
            </p>
            {(user.role === "technician" || user.role === "senior_technician") ? (
              <label
                className="flex items-center gap-2 text-xs text-muted-foreground mt-2"
                data-testid={`equipment-coordinator-row-${user.id}`}
              >
                <Checkbox
                  checked={!!user.isEquipmentCoordinator}
                  onCheckedChange={(checked) =>
                    actions.onToggleEquipmentCoordinator(user, checked === true)
                  }
                  disabled={isMutating}
                  data-testid={`checkbox-equipment-coordinator-${user.id}`}
                />
                {t.adminPage.equipmentCoordinatorLabel}
              </label>
            ) : null}
            {user.role === "vet" ? (
              <label
                className="flex items-center gap-2 text-xs text-muted-foreground mt-2"
                data-testid={`senior-doctor-eligible-row-${user.id}`}
              >
                <Checkbox
                  checked={!!user.seniorDoctorEligible}
                  onCheckedChange={(checked) =>
                    actions.onToggleSeniorDoctorEligible(user, checked === true)
                  }
                  disabled={isMutating}
                  data-testid={`checkbox-senior-doctor-eligible-${user.id}`}
                />
                {t.adminPage.seniorDoctorEligibleLabel}
              </label>
            ) : null}
            {user.status === "pending" ? (
              <div className="flex gap-2 mt-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive h-11 px-2 text-xs"
                  disabled={isMutating}
                  data-testid={`btn-reject-user-${user.id}`}
                  onClick={() => actions.onReject(user)}
                >
                  <XCircle className="w-3 h-3 me-1" />
                  {t.adminPage.reject}
                </Button>
                <Button
                  size="sm"
                  className="bg-[var(--status-ok-fg)] hover:opacity-90 text-white h-11 px-2 text-xs"
                  onClick={() => actions.onApprove(user)}
                  disabled={isMutating}
                  data-testid={`btn-approve-user-${user.id}`}
                >
                  <CheckCircle className="w-3 h-3 me-1" />
                  {t.adminPage.approve}
                </Button>
              </div>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5 shrink-0">
            <div className="flex gap-1.5 justify-end">
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2 text-xs"
                data-testid={`btn-soft-delete-user-${user.id}`}
                disabled={isMutating || Boolean(user.deletedAt)}
                onClick={(e) => {
                  e.stopPropagation();
                  void actions.onSoftDelete(user);
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
                  disabled={isMutating}
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.onRestore(user);
                  }}
                >
                  {t.adminPage.restoreUser}
                </Button>
              ) : null}
            </div>
            <Select
              value={user.role}
              onValueChange={(role) => {
                actions.onRoleChange(user, role as AdminUserRole);
              }}
            >
              <SelectTrigger
                className="w-32 h-8 text-xs"
                data-testid={`select-role-${user.id}`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              disabled={isMutating}
              value={
                pendingSecondaryRoleUserId === user.id && pendingSecondaryRole !== undefined
                  ? (pendingSecondaryRole ?? "none")
                  : (user.secondaryRole ?? "none")
              }
              onValueChange={(val) => {
                actions.onSecondaryRoleChange(user, val === "none" ? null : val);
              }}
            >
              <SelectTrigger
                className="w-32 h-8 text-xs"
                data-testid={`select-secondary-role-${user.id}`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SECONDARY_ROLE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={user.status}
              onValueChange={(status) => {
                actions.onStatusChange(user, status as AdminUserStatus);
              }}
            >
              <SelectTrigger
                className="w-32 h-8 text-xs"
                data-testid={`select-status-${user.id}`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      ))}
    </div>
  );
}
