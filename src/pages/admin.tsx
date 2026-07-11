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
import { cn } from "@/lib/utils";
import { AdminShiftRequestsSection } from "@/features/shift-adjustments/AdminShiftRequestsSection";
import { ManagementAccessDenied } from "@/desktop/management";
import { t } from "@/lib/i18n";
import { FoldersSection } from "@/pages/admin/FoldersSection";
import { PendingUsersSection } from "@/pages/admin/PendingUsersSection";
import { UsersSection } from "@/pages/admin/UsersSection";
import { DeletedItemsSection } from "@/pages/admin/DeletedItemsSection";
import { SupportSection } from "@/pages/admin/SupportSection";

export default function AdminPage() {
  const { isAdmin, userId } = useAuth();
  const [activeTab, setActiveTab] = useState<
    "folders" | "users" | "pending" | "shift-requests" | "support" | "deleted"
  >("folders");

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
          <title>Admin — VetTrack</title>
          <meta
            name="description"
            content="VetTrack administration panel. Manage equipment folders, user roles, and system settings for your veterinary clinic."
          />
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
        <title>Admin — VetTrack</title>
        <meta
          name="description"
          content="VetTrack administration panel. Manage equipment folders, user roles, and system settings for your veterinary clinic."
        />
        <link rel="canonical" href="https://vettrack.replit.app/admin" />
      </Helmet>
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-4 pb-24 pt-3 animate-fade-in sm:px-6 lg:max-w-[1120px]">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold leading-tight flex items-center gap-2">
            <Shield className="w-6 h-6 text-primary" />
            {t.adminPage.pageHeading}
          </h1>
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-3 border-b border-border pb-0 overflow-x-auto scrollbar-none px-1 -mx-1">
          <button
            onClick={() => setActiveTab("folders")}
            data-testid="admin-tab-folders"
            className={cn(
              "flex shrink-0 items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
              activeTab === "folders"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <FolderOpen className="w-4 h-4" />
            {t.adminPage.tabFolders}
          </button>
          <button
            onClick={() => setActiveTab("pending")}
            data-testid="admin-tab-pending"
            className={cn(
              "flex shrink-0 items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors relative whitespace-nowrap",
              activeTab === "pending"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Clock className="w-4 h-4" />
            {t.adminPage.tabPending}
            {pendingCount > 0 && (
              <span className="ms-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-[var(--status-stale-fg)] text-white text-[10px] font-bold">
                {pendingCount > 9 ? "9+" : pendingCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("users")}
            data-testid="admin-tab-users"
            className={cn(
              "flex shrink-0 items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
              activeTab === "users"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Users className="w-4 h-4" />
            {t.adminPage.tabUsers}
          </button>
          <button
            onClick={() => setActiveTab("support")}
            data-testid="admin-tab-support"
            className={cn(
              "flex shrink-0 items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors relative whitespace-nowrap",
              activeTab === "support"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <LifeBuoy className="w-4 h-4" />
            {t.adminPage.tabSupport}
            {unresolvedCount > 0 && (
              <span className="ms-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary text-white text-[10px] font-bold">
                {unresolvedCount > 9 ? "9+" : unresolvedCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("shift-requests")}
            data-testid="admin-tab-shift-requests"
            className={cn(
              "flex shrink-0 items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors relative whitespace-nowrap",
              activeTab === "shift-requests"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <CalendarClock className="w-4 h-4" />
            {t.shiftAdjustments.admin.tab}
            {shiftRequestCount > 0 && (
              <span className="ms-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-[var(--status-stale-fg)] text-white text-[10px] font-bold">
                {shiftRequestCount > 9 ? "9+" : shiftRequestCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("deleted")}
            data-testid="admin-tab-deleted"
            className={cn(
              "flex shrink-0 items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
              activeTab === "deleted"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Trash2 className="w-4 h-4" />
            {t.adminPage.tabDeleted}
          </button>
        </div>

        {activeTab === "folders" && <FoldersSection />}
        {activeTab === "pending" && <PendingUsersSection />}
        {activeTab === "users" && <UsersSection />}
        {activeTab === "shift-requests" && <AdminShiftRequestsSection />}
        {activeTab === "support" && <SupportSection />}
        {activeTab === "deleted" && <DeletedItemsSection />}
      </div>
    </>
  );
  return <AppShell>{pageContent}</AppShell>;
}
