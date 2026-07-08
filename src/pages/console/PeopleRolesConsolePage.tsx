import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { t } from "@/lib/i18n";
import { api } from "@/lib/api";
import { useExperience } from "@/hooks/use-experience";
import { DataTable, type Column } from "@/desktop/management";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Bdi } from "@/components/ui/bdi";
import type { User, UserRole, UserStatus } from "@/types";

/** Client roles → the 5 display labels (lead_technician/vet_tech collapse like the server does). */
const ROLE_LABEL: Record<UserRole, string> = {
  admin: t.adminPage.roleAdmin,
  vet: t.adminPage.roleVet,
  technician: t.adminPage.roleTechnician,
  senior_technician: t.adminPage.roleSeniorTechnician,
  lead_technician: t.adminPage.roleSeniorTechnician,
  vet_tech: t.adminPage.roleTechnician,
  student: t.adminPage.roleStudent,
};

const STATUS: Record<UserStatus, { label: string; variant: "ok" | "secondary" | "issue" }> = {
  active: { label: t.console.people.statusActive, variant: "ok" },
  pending: { label: t.console.people.statusPending, variant: "secondary" },
  blocked: { label: t.console.people.statusBlocked, variant: "issue" },
};

/**
 * People & Roles console (Phase 7 / 7f) — read-only restage of the /admin people
 * roster into the console shell. Reads are `requireAdmin` server-side, so a lead
 * (management.web, no webWrite) sees the chrome + an honest "pending server
 * enablement" state rather than a 403'd fetch. Role editing lands in a follow-up.
 */
export default function PeopleRolesConsolePage() {
  const experience = useExperience();
  const hasServerAccess = experience.can("management.webWrite");

  const usersQ = useQuery({
    queryKey: ["console", "people", "list"],
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
        sortValue: (u) => u.role,
        cell: (u) => ROLE_LABEL[u.role] ?? u.role,
      },
      {
        key: "status",
        header: t.console.colStatus,
        sortValue: (u) => u.status,
        cell: (u) => {
          const s = STATUS[u.status];
          return <Badge variant={s?.variant ?? "secondary"}>{s?.label ?? u.status}</Badge>;
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
          />
        ) : (
          <EmptyState icon={Users} message={t.console.accessPendingServer} />
        )}
      </div>
    </AppShell>
  );
}
