import { useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Users, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { UsersTable } from "@/pages/admin/desktop/UsersTable";
import { UsersMobileList } from "@/pages/admin/UsersMobileList";
import { useAdminUserActions } from "@/pages/admin/use-admin-user-actions";
import { RetainedQueryError } from "@/pages/admin/RetainedQueryError";

type UserStatusFilter = "all" | "pending" | "active" | "blocked";

export function UsersSection() {
  const { userId } = useAuth();
  const [statusFilter, setStatusFilter] = useState<UserStatusFilter>("all");
  const effectiveStatus = statusFilter === "all" ? undefined : statusFilter;
  const {
    rowActions,
    isMutatingUser,
    pendingSecondaryRoleUserId,
    pendingSecondaryRole,
    dialogs,
  } = useAdminUserActions();

  const {
    data: usersPages,
    isLoading,
    isError: usersError,
    isFetchNextPageError,
    refetch: refetchUsers,
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

  const isDesktop = useIsDesktop();

  const retryUsers = () =>
    isFetchNextPageError ? fetchMoreUsers() : refetchUsers();

  const loadMoreButton = hasMoreUsers ? (
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
          <><Loader2 className="w-4 h-4 me-1 motion-safe:animate-spin" />{t.common.loading}</>
        ) : (
          t.adminPage.loadMore
        )}
      </Button>
    </div>
  ) : null;

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
        ) : (
          <RetainedQueryError
            isError={usersError}
            hasCachedData={usersPages !== undefined}
            onRetry={retryUsers}
          >
            {!users || users.length === 0 ? (
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
            ) : isDesktop ? (
              <div className="flex flex-col gap-3">
                <UsersTable
                  users={users}
                  actions={rowActions}
                  isMutating={isMutatingUser}
                  pendingSecondaryRoleUserId={pendingSecondaryRoleUserId}
                  pendingSecondaryRole={pendingSecondaryRole}
                />
                {loadMoreButton}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <UsersMobileList
                  users={users}
                  actions={rowActions}
                  isMutating={isMutatingUser}
                  pendingSecondaryRoleUserId={pendingSecondaryRoleUserId}
                  pendingSecondaryRole={pendingSecondaryRole}
                />
                {loadMoreButton}
              </div>
            )}
          </RetainedQueryError>
        )}
      </CardContent>
      {dialogs}
    </Card>
  );
}
