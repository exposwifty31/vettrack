import { useMemo } from "react";
import { Users, XCircle, CheckCircle } from "lucide-react";
import { DataTable, type Column } from "@/desktop/management/DataTable";
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
import {
  ROLE_OPTIONS,
  SECONDARY_ROLE_OPTIONS,
  STATUS_OPTIONS,
  type AdminUserRole,
  type AdminUserStatus,
} from "@/pages/admin/user-role-options";

/**
 * Every mutation the card row can start. The table itself is stateless: it renders
 * controls and reports intent, so confirm dialogs and mutations stay in
 * `UsersSection` and cannot diverge between the two bodies.
 */
export interface UserRowActions {
  onRoleChange: (user: User, role: AdminUserRole) => void;
  /** `null` clears the secondary role (the select's `none` sentinel). */
  onSecondaryRoleChange: (user: User, secondaryRole: string | null) => void;
  onStatusChange: (user: User, status: AdminUserStatus) => void;
  onToggleEquipmentCoordinator: (user: User, checked: boolean) => void;
  onToggleSeniorDoctorEligible: (user: User, checked: boolean) => void;
  onApprove: (user: User) => void;
  onReject: (user: User) => void;
  onSoftDelete: (user: User) => void;
  onRestore: (user: User) => void;
}

interface UsersTableProps {
  users: User[] | undefined;
  isLoading?: boolean;
  actions: UserRowActions;
  /** Disables the mutating controls while a write is in flight. */
  isMutating?: boolean;
  /**
   * In-flight secondary-role edit, keyed by user (T-44). Scoped to ONE row on
   * purpose: a shared pending value would paint every row's dropdown with the
   * edited row's value while the mutation is in flight.
   */
  pendingSecondaryRoleUserId?: string | null;
  pendingSecondaryRole?: string | null;
}

function displayNameOf(u: User): string {
  return u.displayName || u.name || u.email;
}

/**
 * Dense desktop body for the `/admin` users tab (Track A). The card row stack in
 * `UsersSection` is unchanged and still serves narrow widths.
 *
 * Action parity is deliberate: every control keeps the `data-testid` the card row
 * used, so a de-mobilized layout provably costs the admin nothing. Richer than
 * `/admin/people` (PeopleRolesConsolePage), which is a reduced four-column view.
 */
export function UsersTable({
  users,
  isLoading,
  actions,
  isMutating,
  pendingSecondaryRoleUserId,
  pendingSecondaryRole,
}: UsersTableProps) {
  const columns = useMemo<Column<User>[]>(
    () => [
      {
        key: "name",
        header: t.console.colName,
        sortValue: (u) => displayNameOf(u),
        cell: (u) => (
          <Bdi className="min-w-0">
            <TruncatedText text={displayNameOf(u)} className="text-sm font-medium" as="p" />
          </Bdi>
        ),
      },
      {
        key: "email",
        header: t.console.colEmail,
        sortValue: (u) => u.email,
        cell: (u) => (
          <Bdi dir="ltr">
            <TruncatedText text={u.email} className="text-xs text-muted-foreground" as="p" />
          </Bdi>
        ),
      },
      {
        key: "role",
        header: t.console.colRole,
        sortValue: (u) => u.role,
        cell: (u) => (
          <Select
            value={u.role}
            onValueChange={(role) => actions.onRoleChange(u, role as AdminUserRole)}
          >
            <SelectTrigger className="h-8 w-32 text-xs" data-testid={`select-role-${u.id}`}>
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
        ),
      },
      {
        key: "secondaryRole",
        header: t.adminPage.secondaryRoleTooltip,
        sortValue: (u) => u.secondaryRole ?? "",
        cell: (u) => (
          <Select
            value={
              pendingSecondaryRoleUserId === u.id && pendingSecondaryRole !== undefined
                ? (pendingSecondaryRole ?? "none")
                : (u.secondaryRole ?? "none")
            }
            onValueChange={(val) => actions.onSecondaryRoleChange(u, val === "none" ? null : val)}
          >
            <SelectTrigger
              className="h-8 w-32 text-xs"
              data-testid={`select-secondary-role-${u.id}`}
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
        ),
      },
      {
        key: "status",
        header: t.console.colStatus,
        sortValue: (u) => u.status,
        cell: (u) => (
          <Select
            value={u.status}
            onValueChange={(status) => actions.onStatusChange(u, status as AdminUserStatus)}
          >
            <SelectTrigger className="h-8 w-32 text-xs" data-testid={`select-status-${u.id}`}>
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
        ),
      },
      {
        key: "flags",
        header: t.console.colFlags,
        // Same role predicates the card row uses — an eligibility flag that does not
        // apply to the role must stay absent, not merely disabled.
        cell: (u) => (
          <span className="flex flex-col gap-1">
            {(u.role === "technician" || u.role === "senior_technician") && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={!!u.isEquipmentCoordinator}
                  onCheckedChange={(checked) =>
                    actions.onToggleEquipmentCoordinator(u, checked === true)
                  }
                  disabled={isMutating}
                  data-testid={`checkbox-equipment-coordinator-${u.id}`}
                />
                {t.adminPage.equipmentCoordinatorLabel}
              </label>
            )}
            {u.role === "vet" && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={!!u.seniorDoctorEligible}
                  onCheckedChange={(checked) =>
                    actions.onToggleSeniorDoctorEligible(u, checked === true)
                  }
                  disabled={isMutating}
                  data-testid={`checkbox-senior-doctor-eligible-${u.id}`}
                />
                {t.adminPage.seniorDoctorEligibleLabel}
              </label>
            )}
          </span>
        ),
      },
      {
        key: "joined",
        header: t.console.colJoined,
        sortValue: (u) => new Date(u.createdAt).getTime(),
        cell: (u) => (
          <Bdi className="text-xs text-muted-foreground">{formatDateByLocale(u.createdAt)}</Bdi>
        ),
      },
      {
        key: "actions",
        header: t.console.colActions,
        cell: (u) => (
          <span className="flex flex-wrap gap-1.5">
            {u.status === "pending" && (
              <>
                <Button
                  size="sm"
                  className="h-8 bg-[var(--status-ok-fg)] px-2 text-xs text-white hover:opacity-90"
                  disabled={isMutating}
                  data-testid={`btn-approve-user-${u.id}`}
                  onClick={() => actions.onApprove(u)}
                >
                  <CheckCircle className="me-1 h-3 w-3" />
                  {t.adminPage.approve}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 border-destructive/40 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={isMutating}
                  data-testid={`btn-reject-user-${u.id}`}
                  onClick={() => actions.onReject(u)}
                >
                  <XCircle className="me-1 h-3 w-3" />
                  {t.adminPage.reject}
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-2 text-xs"
              disabled={isMutating || Boolean(u.deletedAt)}
              data-testid={`btn-soft-delete-user-${u.id}`}
              onClick={() => actions.onSoftDelete(u)}
            >
              {t.adminPage.deleteUser}
            </Button>
            {u.deletedAt ? (
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2 text-xs"
                disabled={isMutating}
                data-testid={`btn-restore-user-inline-${u.id}`}
                onClick={() => actions.onRestore(u)}
              >
                {t.adminPage.restoreUser}
              </Button>
            ) : null}
          </span>
        ),
      },
    ],
    [actions, isMutating, pendingSecondaryRoleUserId, pendingSecondaryRole],
  );

  return (
    <DataTable
      columns={columns}
      rows={users}
      rowKey={(u) => u.id}
      rowTestId={(u) => `user-row-${u.id}`}
      isLoading={isLoading}
      emptyIcon={Users}
      emptyMessage={t.adminPage.noUsersYet}
    />
  );
}
