import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { api } from "@/lib/api";
import { leaderPoll } from "@/lib/leader";
import { AppShell } from "@/components/layout/AppShell";
import {
  Shield,
  Users,
  FolderOpen,
  Trash2,
  LifeBuoy,
  Clock,
  CalendarClock,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdminShiftRequestsSection } from "@/features/shift-adjustments/AdminShiftRequestsSection";
import { ManagementAccessDenied } from "@/desktop/management";
import { t } from "@/lib/i18n";
import { FoldersSection } from "@/pages/admin/FoldersSection";
import { PendingUsersSection } from "@/pages/admin/PendingUsersSection";
import { UsersSection } from "@/pages/admin/UsersSection";
import { DeletedItemsSection } from "@/pages/admin/DeletedItemsSection";
import { SupportSection } from "@/pages/admin/SupportSection";

const ADMIN_TABS = [
  "folders",
  "users",
  "pending",
  "shift-requests",
  "support",
  "deleted",
] as const;

type AdminTab = (typeof ADMIN_TABS)[number];

function isAdminTab(value: string): value is AdminTab {
  return (ADMIN_TABS as readonly string[]).includes(value);
}

/**
 * Underline-strip look on top of the shared Radix trigger. The base
 * `TabsTrigger` styles a segmented pill (rounded, filled active state); these
 * overrides restore the admin strip's border-bottom treatment while keeping the
 * primitive's focus ring, roving tabindex and arrow-key navigation.
 */
const tabTriggerClass =
  "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-none border-b-2 border-transparent bg-transparent px-3 py-2 text-sm font-medium text-muted-foreground shadow-none transition-colors hover:text-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none";

export default function AdminPage() {
  const { isAdmin, userId } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTab>("folders");

  const { data: supportUnresolved } = useQuery({
    queryKey: ["/api/support/unresolved-count"],
    queryFn: api.support.unresolvedCount,
    enabled: isAdmin && !!userId,
    refetchInterval: leaderPoll(60_000),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const { data: pendingUsers } = useQuery({
    queryKey: ["/api/users/pending"],
    queryFn: api.users.listPending,
    enabled: isAdmin && !!userId,
    refetchInterval: leaderPoll(30_000),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const { data: pendingShiftRequests } = useQuery({
    queryKey: ["/api/shift-adjustments", "pending"],
    queryFn: () => api.shiftAdjustments.list("pending"),
    enabled: isAdmin && !!userId,
    refetchInterval: leaderPoll(30_000),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    retry: false,
  });

  // T22: literal isAdmin (not management.web) — this page's data (pending users,
  // folders, deletions) is genuinely admin-only server-side, narrower than the
  // lead-inclusive console floor. Only the denial UI is unified.
  if (!isAdmin) {
    return (
      <AppShell>
        <Helmet>
          <title>{t.adminPage.pageHeading} — VetTrack</title>
          <meta name="description" content={t.adminPage.metaDescription} />
        </Helmet>
        <ManagementAccessDenied />
      </AppShell>
    );
  }

  const unresolvedCount = supportUnresolved?.count ?? 0;
  const pendingCount = pendingUsers?.length ?? 0;
  const shiftRequestCount = pendingShiftRequests?.length ?? 0;

  const pageContent = (
    <>
      <Helmet>
        <title>{t.adminPage.pageHeading} — VetTrack</title>
        <meta name="description" content={t.adminPage.metaDescription} />
        <link rel="canonical" href="https://vettrack.replit.app/admin" />
      </Helmet>
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-4 pb-24 pt-3 animate-fade-in sm:px-6 lg:max-w-[1120px]">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold leading-tight flex items-center gap-2">
            <Shield className="w-6 h-6 text-primary" />
            {t.adminPage.pageHeading}
          </h1>
        </div>

        {/* Tab bar — Radix Tabs supplies tablist/tab/tabpanel roles, aria-selected,
            the roving tabindex and arrow-key navigation the hand-rolled strip had none of. */}
        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            if (isAdminTab(value)) setActiveTab(value);
          }}
          className="flex flex-col gap-6"
        >
          <TabsList className="flex h-auto items-center justify-start gap-3 rounded-none border-b border-border bg-transparent p-0 pb-0 -mx-1 px-1 overflow-x-auto scrollbar-none">
            <TabsTrigger value="folders" data-testid="admin-tab-folders" className={tabTriggerClass}>
              <FolderOpen className="w-4 h-4" />
              {t.adminPage.tabFolders}
            </TabsTrigger>
            <TabsTrigger value="pending" data-testid="admin-tab-pending" className={tabTriggerClass}>
              <Clock className="w-4 h-4" />
              {t.adminPage.tabPending}
              {pendingCount > 0 && (
                <span className="ms-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-[var(--status-stale-fg)] text-white text-[10px] font-bold">
                  {pendingCount > 9 ? "9+" : pendingCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="users" data-testid="admin-tab-users" className={tabTriggerClass}>
              <Users className="w-4 h-4" />
              {t.adminPage.tabUsers}
            </TabsTrigger>
            <TabsTrigger value="support" data-testid="admin-tab-support" className={tabTriggerClass}>
              <LifeBuoy className="w-4 h-4" />
              {t.adminPage.tabSupport}
              {unresolvedCount > 0 && (
                <span className="ms-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary text-white text-[10px] font-bold">
                  {unresolvedCount > 9 ? "9+" : unresolvedCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="shift-requests"
              data-testid="admin-tab-shift-requests"
              className={tabTriggerClass}
            >
              <CalendarClock className="w-4 h-4" />
              {t.shiftAdjustments.admin.tab}
              {shiftRequestCount > 0 && (
                <span className="ms-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-[var(--status-stale-fg)] text-white text-[10px] font-bold">
                  {shiftRequestCount > 9 ? "9+" : shiftRequestCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="deleted" data-testid="admin-tab-deleted" className={tabTriggerClass}>
              <Trash2 className="w-4 h-4" />
              {t.adminPage.tabDeleted}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="folders" className="mt-0"><FoldersSection /></TabsContent>
          <TabsContent value="pending" className="mt-0"><PendingUsersSection /></TabsContent>
          <TabsContent value="users" className="mt-0"><UsersSection /></TabsContent>
          <TabsContent value="shift-requests" className="mt-0"><AdminShiftRequestsSection /></TabsContent>
          <TabsContent value="support" className="mt-0"><SupportSection /></TabsContent>
          <TabsContent value="deleted" className="mt-0"><DeletedItemsSection /></TabsContent>
        </Tabs>
      </div>
    </>
  );
  return <AppShell>{pageContent}</AppShell>;
}
