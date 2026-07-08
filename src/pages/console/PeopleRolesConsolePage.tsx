import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { t } from "@/lib/i18n";
import { api } from "@/lib/api";
import { useExperience } from "@/hooks/use-experience";
import { DataTable, type Column } from "@/desktop/management";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Bdi } from "@/components/ui/bdi";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { User, UserRole, UserStatus } from "@/types";

/** The 5 roles the server accepts on updateRole (client-only lead_technician/vet_tech collapse). */
type ServerRole = "admin" | "vet" | "senior_technician" | "technician" | "student";
const SERVER_ROLES: ServerRole[] = ["admin", "vet", "senior_technician", "technician", "student"];

/**
 * Client roles → the 5 display labels (lead_technician/vet_tech collapse like the
 * server does). Read `t` LAZILY (at call time): `t` is a reassignable binding that
 * changes on locale switch, so capturing it in a module-level const would go stale.
 */
function roleLabel(role: UserRole): string {
  switch (role) {
    case "admin": return t.adminPage.roleAdmin;
    case "vet": return t.adminPage.roleVet;
    case "senior_technician":
    case "lead_technician": return t.adminPage.roleSeniorTechnician;
    case "technician":
    case "vet_tech": return t.adminPage.roleTechnician;
    case "student": return t.adminPage.roleStudent;
  }
}

function statusMeta(status: UserStatus): { label: string; variant: "ok" | "secondary" | "issue" } {
  switch (status) {
    case "active": return { label: t.console.people.statusActive, variant: "ok" };
    case "pending": return { label: t.console.people.statusPending, variant: "secondary" };
    case "blocked": return { label: t.console.people.statusBlocked, variant: "issue" };
  }
}

/** Canonical react-query key for the clinic user list — shared with UsersSection + friends. */
const USERS_KEY = ["/api/users"] as const;

/** Collapse the 7 client roles onto the 5 the updateRole endpoint accepts (server parity). */
export function toServerRole(role: UserRole): ServerRole {
  if (role === "lead_technician") return "senior_technician";
  if (role === "vet_tech") return "technician";
  if (role === "admin" || role === "vet" || role === "senior_technician" || role === "technician") return role;
  return "student";
}

/** Role-edit drawer. Editable Role only; status is a read-only pill; no secondaryRole (roadmap 7f v1). */
function RoleEditSheet({ user, onClose }: { user: User; onClose: () => void }) {
  const queryClient = useQueryClient();
  const initialRole = toServerRole(user.role);
  const [role, setRole] = useState<ServerRole>(initialRole);

  const mut = useMutation({
    mutationFn: () => api.users.updateRole(user.id, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: USERS_KEY });
      toast.success(t.adminPage.roleUpdated);
      onClose();
    },
    onError: () => toast.error(t.adminPage.roleUpdateFailed),
  });

  const status = statusMeta(user.status);

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full max-w-md">
        <SheetHeader>
          <SheetTitle>{t.console.people.editTitle}</SheetTitle>
          <SheetDescription>
            <Bdi>{user.displayName || user.name || user.email}</Bdi>
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 py-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">{t.console.colStatus}</span>
            <div>
              <Badge variant={status.variant}>{status.label}</Badge>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground" htmlFor="people-role">
              {t.console.colRole}
            </label>
            <Select value={role} onValueChange={(v) => setRole(v as ServerRole)}>
              <SelectTrigger id="people-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SERVER_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {roleLabel(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <SheetFooter>
          <Button variant="outline" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || role === initialRole}>
            {t.console.people.save}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/**
 * People & Roles console (Phase 7 / 7f) — restages the /admin people roster into
 * the console shell. Reads are `requireAdmin` server-side, so a lead (management.web,
 * no webWrite) sees the chrome + an honest "pending server enablement" state rather
 * than a 403'd fetch. Row click opens the role-edit drawer.
 */
export default function PeopleRolesConsolePage() {
  const experience = useExperience();
  const hasServerAccess = experience.can("management.webWrite");
  const [editing, setEditing] = useState<User | null>(null);

  const usersQ = useQuery({
    queryKey: USERS_KEY,
    queryFn: () => api.users.list(),
    enabled: hasServerAccess,
    retry: false,
  });

  const columns = useMemo<Column<User>[]>(
    () => [
      {
        key: "name",
        header: t.console.colName,
        sortValue: (u) => u.displayName || u.name || u.email,
        cell: (u) => <Bdi className="font-medium">{u.displayName || u.name || u.email}</Bdi>,
      },
      {
        key: "email",
        header: t.console.colEmail,
        sortValue: (u) => u.email,
        cell: (u) => <Bdi className="text-muted-foreground">{u.email}</Bdi>,
      },
      {
        key: "role",
        header: t.console.colRole,
        sortValue: (u) => roleLabel(u.role),
        cell: (u) => roleLabel(u.role),
      },
      {
        key: "status",
        header: t.console.colStatus,
        sortValue: (u) => u.status,
        cell: (u) => {
          const s = statusMeta(u.status);
          return <Badge variant={s.variant}>{s.label}</Badge>;
        },
      },
    ],
    [],
  );

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold text-foreground">{t.console.people.title}</h1>
          <p className="text-sm text-muted-foreground">{t.console.people.subtitle}</p>
        </header>
        {hasServerAccess ? (
          <DataTable
            columns={columns}
            rows={usersQ.data}
            rowKey={(u) => u.id}
            isLoading={usersQ.isLoading}
            isError={usersQ.isError}
            onRetry={() => usersQ.refetch()}
            emptyIcon={Users}
            emptyMessage={t.console.state.empty}
            onRowClick={(u) => setEditing(u)}
          />
        ) : (
          <EmptyState icon={Users} message={t.console.accessPendingServer} />
        )}
      </div>
      {editing && <RoleEditSheet user={editing} onClose={() => setEditing(null)} />}
    </AppShell>
  );
}
