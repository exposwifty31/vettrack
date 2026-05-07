import { useState, useMemo } from "react";
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { api } from "@/lib/api";
import { leaderPoll } from "@/lib/leader";
import { Layout } from "@/components/layout";
import { PageShell } from "@/components/layout/PageShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import {
  Shield,
  Users,
  FolderOpen,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  LifeBuoy,
  ChevronDown,
  ChevronUp,
  Clock,
  CheckCircle,
  XCircle,
  ClipboardList,
  Search,
  RefreshCw,
  RotateCcw,
  Wrench,
  CalendarDays,
  Settings,
  Mail,
  FlaskConical,
  X,
} from "lucide-react";
import type { DrugFormularyEntry, CreateDrugFormularyRequest, PharmacyForecastExclusion } from "@/types";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import type {
  SupportTicket,
  SupportTicketStatus,
  User,
  DeletedEquipment,
} from "@/types";
import { SharedAuditLogsPanel } from "./audit-log";
import { t, formatDateByLocale } from "@/lib/i18n";
import { haptics } from "@/lib/haptics";

export default function AdminPage() {
  const { isAdmin, userId } = useAuth();
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState<
    "folders" | "users" | "pending" | "support" | "audit-logs" | "deleted" | "settings" | "formulary"
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

  const isDesktop = typeof window !== "undefined" && window.innerWidth >= 1024;

  if (!isAdmin) {
    const earlyContent = (
      <>
        <Helmet>
          <title>Admin — VetTrack</title>
          <meta
            name="description"
            content="VetTrack administration panel. Manage equipment folders, user roles, and system settings for your veterinary clinic."
          />
        </Helmet>
        <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
          <Shield className="w-12 h-12 text-muted-foreground" />
          <h1 className="text-2xl font-bold">גישת מנהל בלבד</h1>
          <p className="text-sm text-muted-foreground">
            נדרשת הרשאת מנהל לצפות בדף זה.
          </p>
          <Button variant="ghost" onClick={() => navigate("/home")}>
            לדף הבית
          </Button>
        </div>
      </>
    );
    if (isDesktop) return <PageShell>{earlyContent}</PageShell>;
    return <Layout>{earlyContent}</Layout>;
  }

  const unresolvedCount = supportUnresolved?.count ?? 0;
  const pendingCount = pendingUsers?.length ?? 0;

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
      <div className="flex flex-col gap-6 pb-24 animate-fade-in">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold leading-tight flex items-center gap-2">
            <Shield className="w-6 h-6 text-primary" />
            Admin
          </h1>
          <Button
            size="sm"
            variant="outline"
            className="h-11 text-xs shrink-0"
            onClick={() => navigate("/admin/shifts")}
            data-testid="btn-open-shifts-import"
          >
            <CalendarDays className="w-4 h-4 mr-1" />
            Shifts CSV Import
          </Button>
        </div>

        <Card className="bg-card border-border/60 shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-muted-foreground" />
              Shift CSV Import
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Import EZShift-style schedule rows (Employee, Shift, Date, Start, End) into VetTrack roles.
            </p>
            <Button
              size="sm"
              className="h-11 text-xs shrink-0"
              onClick={() => navigate("/admin/shifts")}
              data-testid="btn-go-to-shifts-import-card"
            >
              Open Import Screen
            </Button>
          </CardContent>
        </Card>

        {/* Tab bar */}
        <div className="flex gap-2 border-b border-border pb-0 overflow-x-auto scrollbar-none">
          <button
            onClick={() => setActiveTab("folders")}
            data-testid="admin-tab-folders"
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
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
              "flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors relative whitespace-nowrap",
              activeTab === "pending"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Clock className="w-4 h-4" />
            {t.adminPage.tabPending}
            {pendingCount > 0 && (
              <span className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-500 text-white text-[10px] font-bold">
                {pendingCount > 9 ? "9+" : pendingCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("users")}
            data-testid="admin-tab-users"
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
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
              "flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors relative whitespace-nowrap",
              activeTab === "support"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <LifeBuoy className="w-4 h-4" />
            {t.adminPage.tabSupport}
            {unresolvedCount > 0 && (
              <span className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary text-white text-[10px] font-bold">
                {unresolvedCount > 9 ? "9+" : unresolvedCount}
              </span>
            )}
          </button>
          <button
            onClick={() => navigate("/admin/shifts")}
            data-testid="admin-tab-shifts"
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <CalendarDays className="w-4 h-4" />
            Shifts
          </button>
          <button
            onClick={() => setActiveTab("audit-logs")}
            data-testid="admin-tab-audit-logs"
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
              activeTab === "audit-logs"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <ClipboardList className="w-4 h-4" />
            {t.adminPage.tabLogs}
          </button>
          <button
            onClick={() => setActiveTab("deleted")}
            data-testid="admin-tab-deleted"
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
              activeTab === "deleted"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Trash2 className="w-4 h-4" />
            {t.adminPage.tabDeleted}
          </button>
          <button
            onClick={() => setActiveTab("formulary")}
            data-testid="admin-tab-formulary"
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
              activeTab === "formulary"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <FlaskConical className="w-4 h-4" />
            Formulary
          </button>
          <button
            onClick={() => setActiveTab("settings")}
            data-testid="admin-tab-settings"
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
              activeTab === "settings"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Settings className="w-4 h-4" />
            Settings
          </button>
        </div>

        {activeTab === "folders" && <FoldersSection />}
        {activeTab === "pending" && <PendingUsersSection />}
        {activeTab === "users" && <UsersSection />}
        {activeTab === "support" && <SupportSection />}
        {activeTab === "audit-logs" && <AuditLogsSection />}
        {activeTab === "deleted" && <DeletedItemsSection />}
        {activeTab === "formulary" && <FormularySection />}
        {activeTab === "settings" && <ClinicSettingsSection />}
      </div>
    </>
  );
  if (isDesktop) return <PageShell>{pageContent}</PageShell>;
  return <Layout>{pageContent}</Layout>;
}

function FoldersSection() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editFolder, setEditFolder] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [folderName, setFolderName] = useState("");

  const { data: folders, isLoading } = useQuery({
    queryKey: ["/api/folders"],
    queryFn: api.folders.list,
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const createMut = useMutation({
    mutationFn: (name: string) => api.folders.create(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/folders"] });
      setCreateOpen(false);
      setFolderName("");
      toast.success(t.adminPage.folderCreated);
    },
    onError: () => toast.error(t.adminPage.folderCreateFailed),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.folders.update(id, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/folders"] });
      setEditFolder(null);
      setFolderName("");
      toast.success(t.adminPage.folderUpdated);
    },
    onError: () => toast.error(t.adminPage.folderUpdateFailed),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.folders.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/folders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      toast.success(t.adminPage.folderDeleted);
    },
    onError: () => toast.error(t.adminPage.folderDeleteFailed),
  });

  const manualFolders = folders?.filter((f) => f.type !== "smart") || [];

  return (
    <Card className="bg-card border-border/60 shadow-sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-muted-foreground" />
            {t.adminPage.foldersTitle}
          </CardTitle>
          <Button
            size="sm"
            className="h-11 text-xs"
            onClick={() => {
              setFolderName("");
              setCreateOpen(true);
            }}
            data-testid="btn-create-folder"
          >
            <Plus className="w-4 h-4 mr-1" />
            New
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex flex-col gap-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {manualFolders.map((f) => (
              <div
                key={f.id}
                className="flex items-center justify-between p-3 bg-muted/50 rounded-xl border"
              >
                <div className="flex items-center gap-2">
                  <FolderOpen className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{f.name}</span>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      setEditFolder(f);
                      setFolderName(f.name);
                    }}
                    data-testid={`btn-edit-folder-${f.id}`}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive hover:text-destructive"
                        data-testid={`btn-delete-folder-${f.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete "{f.name}"?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Equipment in this folder will become unfiled. This
                          cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t.adminPage.cancel}</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => deleteMut.mutate(f.id)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Yes, delete folder
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ))}

            {manualFolders.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                {t.adminPage.noFoldersYet}
              </p>
            )}
          </div>
        )}
      </CardContent>

      {/* Create / Edit folder dialog */}
      <Dialog
        open={createOpen || !!editFolder}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setEditFolder(null);
            setFolderName("");
          }
        }}
      >
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>
              {editFolder ? t.adminPage.editFolder : t.adminPage.createFolder}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-1">
            <Label htmlFor="folderName">{t.adminPage.folderName}</Label>
            <Input
              id="folderName"
              placeholder="e.g. Surgery Room 1"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  editFolder
                    ? updateMut.mutate({ id: editFolder.id, name: folderName })
                    : createMut.mutate(folderName);
                }
              }}
              data-testid="input-folder-name"
            />
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                editFolder
                  ? updateMut.mutate({ id: editFolder.id, name: folderName })
                  : createMut.mutate(folderName);
              }}
              disabled={
                !folderName.trim() || createMut.isPending || updateMut.isPending
              }
              data-testid="btn-save-folder"
            >
              {(createMut.isPending || updateMut.isPending) && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              {editFolder ? t.adminPage.update : t.adminPage.create}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function PendingUsersSection() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();

  const { data: pendingUsers, isLoading } = useQuery({
    queryKey: ["/api/users/pending"],
    queryFn: api.users.listPending,
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const updateStatusMut = useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string;
      status: "active" | "blocked";
    }) => api.users.updateStatus(id, status),
    onSuccess: (_, { status }) => {
      haptics.tap();
      queryClient.invalidateQueries({ queryKey: ["/api/users/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast.success(status === "active" ? t.adminPage.userApproved : t.adminPage.userRejected);
    },
    onError: () => toast.error(t.adminPage.userStatusUpdateFailed),
  });

  return (
    <Card className="bg-card border-border/60 shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Clock className="w-4 h-4 text-muted-foreground" />
          {t.adminPage.pendingUsersTitle}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex flex-col gap-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : !pendingUsers || pendingUsers.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No pending users. All sign-ups have been reviewed.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {pendingUsers.map((user) => (
              <div
                key={user.id}
                data-testid={`pending-user-row-${user.id}`}
                className="flex items-center justify-between p-3 bg-background rounded-xl border border-border gap-3 hover:bg-muted/50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {user.displayName || user.name || user.email}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {user.email}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t.adminPage.signedUp(formatDateByLocale(user.createdAt))}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive h-11 px-2.5"
                        disabled={updateStatusMut.isPending}
                        data-testid={`btn-reject-user-${user.id}`}
                      >
                        <XCircle className="w-3.5 h-3.5 mr-1" />
                        {t.adminPage.reject}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {t.adminPage.rejectUserTitle(user.displayName || user.name || user.email || "")}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {t.adminPage.rejectUserBody}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t.adminPage.cancel}</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() =>
                            updateStatusMut.mutate({
                              id: user.id,
                              status: "blocked",
                            })
                          }
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          {t.adminPage.rejectUserConfirm}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  <Button
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white h-11 px-2.5"
                    onClick={() =>
                      updateStatusMut.mutate({ id: user.id, status: "active" })
                    }
                    disabled={updateStatusMut.isPending}
                    data-testid={`btn-approve-user-${user.id}`}
                  >
                    <CheckCircle className="w-3.5 h-3.5 mr-1" />
                    {t.adminPage.approve}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type UserRole = "admin" | "vet" | "technician" | "senior_technician" | "student";

const ROLE_BADGE_STYLES: Record<UserRole, string> = {
  admin: "bg-primary/10 text-primary border border-primary/30",
  vet: "bg-secondary text-secondary-foreground border border-border",
  technician: "bg-accent text-accent-foreground border border-border",
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
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border bg-emerald-50 text-emerald-700 border-emerald-200">
        Active
      </span>
    );
  }
  if (status === "blocked") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border bg-red-50 text-red-700 border-red-200">
        Blocked
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border bg-amber-50 text-amber-700 border-amber-200">
      {t.adminPage.filterPending}
    </span>
  );
}

type UserStatusFilter = "all" | "pending" | "active" | "blocked";

function UsersSection() {
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
      toast.success("תפקיד משני עודכן");
    },
    onError: () => toast.error("עדכון תפקיד משני נכשל"),
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

  const deleteUserMut = useMutation({
    mutationFn: (id: string) => api.users.delete(id),
    onSuccess: () => {
      haptics.tap();
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users/deleted"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users/pending"] });
      toast.success(t.adminPage.userDeleted);
    },
    onError: () => toast.error(t.adminPage.userRestoreFailed),
  });

  const restoreUserMut = useMutation({
    mutationFn: (id: string) => api.users.restore(id),
    onSuccess: () => {
      haptics.tap();
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users/deleted"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users/pending"] });
      toast.success("משתמש שוחזר");
    },
    onError: () => toast.error("שחזור משתמש נכשל"),
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
                : `No ${statusFilter} users`
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
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium truncate">
                      {user.displayName || user.name || user.email}
                    </p>
                    <RoleBadge role={user.role} />
                    {user.secondaryRole && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border border-border bg-muted text-muted-foreground">
                        +{user.secondaryRole}
                      </span>
                    )}
                    <StatusBadge status={user.status} />
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {user.email}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t.adminPage.joined(formatDateByLocale(user.createdAt))}
                  </p>
                  {user.status === "pending" && (
                    <div className="flex gap-2 mt-2">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive h-11 px-2 text-xs"
                            disabled={updateStatusMut.isPending}
                            data-testid={`btn-reject-user-${user.id}`}
                          >
                            <XCircle className="w-3 h-3 mr-1" />
                            {t.adminPage.reject}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              {t.adminPage.rejectUserTitle(user.displayName || user.name || user.email || "")}
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              {t.adminPage.rejectUserBody}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t.adminPage.cancel}</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() =>
                                updateStatusMut.mutate({
                                  id: user.id,
                                  status: "blocked",
                                })
                              }
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              {t.adminPage.rejectUserConfirm}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                      <Button
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700 text-white h-11 px-2 text-xs"
                        onClick={() =>
                          updateStatusMut.mutate({
                            id: user.id,
                            status: "active",
                          })
                        }
                        disabled={updateStatusMut.isPending}
                        data-testid={`btn-approve-user-${user.id}`}
                      >
                        <CheckCircle className="w-3 h-3 mr-1" />
                        {t.adminPage.approve}
                      </Button>
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1.5 shrink-0">
                  <div className="flex gap-1.5 justify-end">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 px-2 text-xs"
                          data-testid={`btn-soft-delete-user-${user.id}`}
                          disabled={deleteUserMut.isPending || Boolean(user.deletedAt)}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {t.adminPage.deleteUser}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            {t.adminPage.deleteUserTitle(user.displayName || user.name || user.email || "")}
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            {t.adminPage.deleteUserBody}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t.adminPage.cancel}</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteUserMut.mutate(user.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            {t.adminPage.deleteUserConfirm}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
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
                      <SelectItem value="none">Secondary: None</SelectItem>
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
                    <><Loader2 className="w-4 h-4 mr-1 animate-spin" />טוען...</>
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
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
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
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : null}
              {t.adminPage.blockUserConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function DeletedItemsSection() {
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
                    <p className="text-sm font-medium truncate">{item.name}</p>
                    {(item.model || item.serialNumber) && (
                      <p className="text-xs text-muted-foreground truncate">
                        {[item.model, item.serialNumber]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
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
                    <p className="text-sm font-medium truncate">
                      {user.displayName || user.name || user.email}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {user.email}
                    </p>
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

const SEVERITY_STYLES: Record<string, string> = {
  low: "bg-primary/5 text-primary border border-primary/25",
  medium: "bg-muted/80 text-foreground border border-amber-500/30",
  high: "bg-destructive/10 text-destructive border border-destructive/20",
};

const STATUS_STYLES: Record<string, string> = {
  open: "bg-destructive/10 text-destructive border border-destructive/20",
  in_progress: "bg-muted/80 text-foreground border border-amber-500/30",
  resolved: "bg-status-ok/10 text-status-ok border border-status-ok/25",
};

const STATUS_LABELS: Record<string, string> = {
  open: t.adminPage.ticketStatusOpen,
  in_progress: t.adminPage.ticketStatusInProgress,
  resolved: t.adminPage.ticketStatusResolved,
};

function SupportSection() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(
    null,
  );
  const [detailStatus, setDetailStatus] = useState<SupportTicketStatus>("open");
  const [detailNote, setDetailNote] = useState("");
  const [expandedDevice, setExpandedDevice] = useState(false);

  const { data: tickets, isLoading } = useQuery({
    queryKey: ["/api/support"],
    queryFn: api.support.list,
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const updateMut = useMutation({
    mutationFn: ({
      id,
      status,
      adminNote,
    }: {
      id: string;
      status: SupportTicketStatus;
      adminNote: string;
    }) => api.support.update(id, { status, adminNote }),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["/api/support"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/support/unresolved-count"],
      });
      setSelectedTicket(updated);
      toast.success(t.adminPage.ticketUpdated);
    },
    onError: () => toast.error(t.adminPage.ticketUpdateFailed),
  });

  const openDetail = (ticket: SupportTicket) => {
    setSelectedTicket(ticket);
    setDetailStatus(ticket.status);
    setDetailNote(ticket.adminNote || "");
    setExpandedDevice(false);
  };

  return (
    <Card className="bg-card border-border/60 shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
          <LifeBuoy className="w-4 h-4 text-muted-foreground" />
          {t.adminPage.supportTicketsTitle}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex flex-col gap-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : !tickets || tickets.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-sm text-muted-foreground">
              {t.adminPage.noTicketsYet}
            </p>
            <p className="text-xs text-muted-foreground/80 mt-1">
              {t.adminPage.noTicketsYetSub}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {tickets.map((ticket) => (
              <button
                key={ticket.id}
                onClick={() => openDetail(ticket)}
                data-testid={`ticket-row-${ticket.id}`}
                className="flex items-start justify-between p-3 bg-muted/50 rounded-xl border border-border hover:bg-muted/50 transition-colors text-left w-full gap-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{ticket.title}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {ticket.userEmail}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatDateByLocale(ticket.createdAt)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[10px]"
                    onClick={(e) => {
                      e.stopPropagation();
                      updateMut.mutate({
                        id: ticket.id,
                        status: "resolved",
                        adminNote: ticket.adminNote || "",
                      });
                    }}
                    disabled={updateMut.isPending || ticket.status === "resolved"}
                  >
                    Resolve
                  </Button>
                  <span
                    className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded border font-medium uppercase",
                      SEVERITY_STYLES[ticket.severity],
                    )}
                  >
                    {ticket.severity}
                  </span>
                  <span
                    className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded border font-medium",
                      STATUS_STYLES[ticket.status],
                    )}
                  >
                    {STATUS_LABELS[ticket.status]}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </CardContent>

      {/* Ticket detail dialog */}
      <Dialog
        open={!!selectedTicket}
        onOpenChange={(open) => {
          if (!open) setSelectedTicket(null);
        }}
      >
        {selectedTicket && (
          <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="pr-6 leading-tight">
                {selectedTicket.title}
              </DialogTitle>
            </DialogHeader>

            <div className="flex flex-col gap-4">
              <div className="flex gap-2 flex-wrap">
                <span
                  className={cn(
                    "text-xs px-2 py-0.5 rounded border font-medium uppercase",
                    SEVERITY_STYLES[selectedTicket.severity],
                  )}
                >
                  {selectedTicket.severity} severity
                </span>
                <span
                  className={cn(
                    "text-xs px-2 py-0.5 rounded border font-medium",
                    STATUS_STYLES[selectedTicket.status],
                  )}
                >
                  {STATUS_LABELS[selectedTicket.status]}
                </span>
              </div>

              <div className="flex flex-col gap-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Description
                </p>
                <p className="text-sm whitespace-pre-wrap">
                  {selectedTicket.description}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div>
                  <span className="font-semibold text-muted-foreground">
                    Submitted by
                  </span>
                  <p className="truncate">{selectedTicket.userEmail}</p>
                </div>
                <div>
                  <span className="font-semibold text-muted-foreground">
                    Date
                  </span>
                  <p>{new Date(selectedTicket.createdAt).toLocaleString()}</p>
                </div>
                {selectedTicket.pageUrl && (
                  <div className="col-span-2">
                    <span className="font-semibold text-muted-foreground">
                      Page URL
                    </span>
                    <p className="truncate">{selectedTicket.pageUrl}</p>
                  </div>
                )}
                {selectedTicket.appVersion && (
                  <div>
                    <span className="font-semibold text-muted-foreground">
                      App Version
                    </span>
                    <p>{selectedTicket.appVersion}</p>
                  </div>
                )}
              </div>

              {selectedTicket.deviceInfo && (
                <div>
                  <button
                    onClick={() => setExpandedDevice((v) => !v)}
                    className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {expandedDevice ? (
                      <ChevronUp className="w-3 h-3" />
                    ) : (
                      <ChevronDown className="w-3 h-3" />
                    )}
                    Device Info
                  </button>
                  {expandedDevice && (
                    <p className="text-xs mt-1 text-muted-foreground break-all">
                      {selectedTicket.deviceInfo}
                    </p>
                  )}
                </div>
              )}

              <div className="border-t border-border pt-4 flex flex-col gap-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Admin Actions
                </p>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ticket-status" className="text-xs">
                    Status
                  </Label>
                  <Select
                    value={detailStatus}
                    onValueChange={(v) =>
                      setDetailStatus(v as SupportTicketStatus)
                    }
                  >
                    <SelectTrigger
                      id="ticket-status"
                      data-testid="select-ticket-status"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">{t.adminPage.ticketStatusOpen}</SelectItem>
                      <SelectItem value="in_progress">{t.adminPage.ticketStatusInProgress}</SelectItem>
                      <SelectItem value="resolved">{t.adminPage.ticketStatusResolved}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ticket-note" className="text-xs">
                    Internal Note
                  </Label>
                  <Textarea
                    id="ticket-note"
                    placeholder={t.adminPage.internalNotePlaceholder}
                    value={detailNote}
                    onChange={(e) => setDetailNote(e.target.value)}
                    rows={3}
                    data-testid="input-ticket-note"
                  />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => setSelectedTicket(null)}
                disabled={updateMut.isPending}
              >
                Close
              </Button>
              <Button
                onClick={() => {
                  updateMut.mutate({
                    id: selectedTicket.id,
                    status: detailStatus,
                    adminNote: detailNote,
                  });
                }}
                disabled={updateMut.isPending}
                data-testid="btn-update-ticket"
              >
                {updateMut.isPending && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                )}
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </Card>
  );
}

function AuditLogsSection() {
  return <SharedAuditLogsPanel compact />;
}

const DOSE_UNITS = ["mg_per_kg", "mcg_per_kg", "mEq_per_kg", "tablet"] as const;
const UNIT_TYPES = ["vial", "ampule", "tablet", "capsule", "bag"] as const;
const ROUTES = ["PO", "IV", "IM", "SC", "IN", "TOP"] as const;
/** Radix Select rejects empty string item values; map this to null in form state. */
const FORMULARY_SELECT_NONE = "__none__" as const;

interface FormularyFormState {
  name: string;
  genericName: string;
  concentrationMgMl: string;
  standardDose: string;
  minDose: string;
  maxDose: string;
  doseUnit: "mg_per_kg" | "mcg_per_kg" | "mEq_per_kg" | "tablet";
  defaultRoute: string | null;
  unitType: "vial" | "ampule" | "tablet" | "capsule" | "bag" | null;
  unitVolumeMl: string;
  category: string | null;
  dosageNotes: string | null;
}

const emptyForm = (): FormularyFormState => ({
  name: "",
  genericName: "",
  concentrationMgMl: "",
  standardDose: "",
  minDose: "",
  maxDose: "",
  doseUnit: "mg_per_kg",
  defaultRoute: null,
  unitType: null,
  unitVolumeMl: "",
  category: null,
  dosageNotes: null,
});

function FormularySection() {
  const queryClient = useQueryClient();
  const [editEntry, setEditEntry] = useState<DrugFormularyEntry | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [search, setSearch] = useState("");

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["/api/formulary"],
    queryFn: api.formulary.list,
  });

  const { data: exclusionData, isLoading: excLoading } = useQuery({
    queryKey: ["/api/forecast/clinic/pharmacy-forecast-exclusions"],
    queryFn: api.forecast.listExclusions,
  });

  const exclusions = exclusionData?.exclusions ?? [];

  const [newExclusion, setNewExclusion] = useState("");
  const [newExclusionNote, setNewExclusionNote] = useState("");

  const upsertMut = useMutation({
    mutationFn: (data: CreateDrugFormularyRequest) =>
      editEntry ? api.formulary.update(editEntry.id, data) : api.formulary.upsert(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/formulary"] });
      setEditEntry(null);
      setShowCreate(false);
      setForm(emptyForm());
      toast.success(editEntry ? "Entry updated" : "Entry added");
    },
    onError: (e: Error) => toast.error(e.message || "Failed to save"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.formulary.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/formulary"] });
      toast.success(t.adminPage.folderDeleted);
    },
    onError: () => toast.error(t.adminPage.folderDeleteFailed),
  });

  const addExclusionMut = useMutation({
    mutationFn: () => {
      const note = newExclusionNote.trim();
      return api.forecast.addExclusion({
        matchSubstring: newExclusion.trim(),
        ...(note ? { note } : {}),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/forecast/clinic/pharmacy-forecast-exclusions"] });
      setNewExclusion("");
      setNewExclusionNote("");
      toast.success("חריג נוסף");
    },
    onError: (e: Error) => toast.error(e.message || "Failed to add exclusion"),
  });

  const removeExclusionMut = useMutation({
    mutationFn: (id: string) => api.forecast.removeExclusion(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/forecast/clinic/pharmacy-forecast-exclusions"] });
      toast.success("חריג הוסר");
    },
    onError: () => toast.error("הסרת חריג נכשלה"),
  });

  function openCreate() {
    setEditEntry(null);
    setForm(emptyForm());
    setShowCreate(true);
  }

  function openEdit(entry: DrugFormularyEntry) {
    setEditEntry(entry);
    setForm({
      name: entry.name,
      genericName: entry.genericName,
      concentrationMgMl: String(entry.concentrationMgMl),
      standardDose: String(entry.standardDose),
      minDose: entry.minDose != null ? String(entry.minDose) : "",
      maxDose: entry.maxDose != null ? String(entry.maxDose) : "",
      doseUnit: (DOSE_UNITS as readonly string[]).includes(entry.doseUnit) ? entry.doseUnit : "mg_per_kg",
      defaultRoute: entry.defaultRoute ?? null,
      unitType: entry.unitType ?? null,
      unitVolumeMl: entry.unitVolumeMl != null ? String(entry.unitVolumeMl) : "",
      category: entry.category ?? null,
      dosageNotes: entry.dosageNotes ?? null,
    });
    setShowCreate(true);
  }

  function handleSubmit() {
    const conc = parseFloat(form.concentrationMgMl);
    const std = parseFloat(form.standardDose);
    if (!form.name.trim() || !form.genericName.trim() || !Number.isFinite(conc) || !Number.isFinite(std)) {
      toast.error("שם, שם גנרי, ריכוז ומינון סטנדרטי הם שדות חובה");
      return;
    }
    const min = form.minDose ? parseFloat(form.minDose) : null;
    const max = form.maxDose ? parseFloat(form.maxDose) : null;
    const vol = form.unitVolumeMl ? parseFloat(form.unitVolumeMl) : null;
    upsertMut.mutate({
      name: form.name.trim(),
      genericName: form.genericName.trim(),
      concentrationMgMl: conc,
      standardDose: std,
      minDose: min && Number.isFinite(min) ? min : null,
      maxDose: max && Number.isFinite(max) ? max : null,
      doseUnit: form.doseUnit,
      defaultRoute: form.defaultRoute || null,
      unitType: form.unitType || null,
      unitVolumeMl: vol && Number.isFinite(vol) ? vol : null,
      category: form.category || null,
      dosageNotes: form.dosageNotes || null,
    });
  }

  const filtered = useMemo(
    () =>
      entries.filter(
        (e) =>
          !search ||
          e.name.toLowerCase().includes(search.toLowerCase()) ||
          e.genericName.toLowerCase().includes(search.toLowerCase()),
      ),
    [entries, search],
  );

  const f = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <div className="flex flex-col gap-4">
      {/* Drug Formulary */}
      <Card className="bg-card border-border/60 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-muted-foreground" />
            Drug Formulary
          </CardTitle>
          <Button size="sm" onClick={openCreate} data-testid="btn-add-formulary">
            <Plus className="w-4 h-4 mr-1" />
            Add Drug
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Input
            placeholder="Search drugs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs h-8 text-sm"
          />
          {isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">לא נמצאו רשומות.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-1.5 pr-3 font-medium">Name</th>
                    <th className="text-left py-1.5 pr-3 font-medium">Generic</th>
                    <th className="text-left py-1.5 pr-3 font-medium">Conc (mg/ml)</th>
                    <th className="text-left py-1.5 pr-3 font-medium">Std Dose</th>
                    <th className="text-left py-1.5 pr-3 font-medium">Unit</th>
                    <th className="text-left py-1.5 pr-3 font-medium">Route</th>
                    <th className="text-left py-1.5 pr-3 font-medium">Form</th>
                    <th className="sticky right-0 bg-card py-1.5 pl-2 pr-0 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((entry) => (
                    <tr key={entry.id} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="py-1.5 pr-3 font-medium">{entry.name}</td>
                      <td className="py-1.5 pr-3 text-muted-foreground">{entry.genericName}</td>
                      <td className="py-1.5 pr-3">{entry.concentrationMgMl}</td>
                      <td className="py-1.5 pr-3">
                        {entry.standardDose} {entry.doseUnit.replace(/_/g, " ")}
                      </td>
                      <td className="py-1.5 pr-3">{entry.unitVolumeMl != null ? `${entry.unitVolumeMl} ml` : "—"}</td>
                      <td className="py-1.5 pr-3">{entry.defaultRoute ?? "—"}</td>
                      <td className="py-1.5 pr-3">{entry.unitType ?? "—"}</td>
                      <td className="py-1.5 pl-2 pr-2 sticky right-0 bg-card border-l border-border/40">
                        <div className="flex gap-1 justify-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            onClick={() => openEdit(entry)}
                            title={t.common.edit}
                            aria-label={`${t.common.edit} ${entry.name}`}
                            data-testid={`btn-edit-formulary-${entry.id}`}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                                disabled={deleteMut.isPending}
                                title={t.common.delete}
                                aria-label={`${t.common.delete} ${entry.name}`}
                                data-testid={`btn-delete-formulary-${entry.id}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>{t.adminPage.formularyDeleteTitle(entry.name)}</AlertDialogTitle>
                                <AlertDialogDescription>
                                  {t.adminPage.formularyDeleteBody}
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>{t.adminPage.cancel}</AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  onClick={() => deleteMut.mutate(entry.id)}
                                >
                                  {t.common.delete}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pharmacy Forecast Exclusions */}
      <Card className="bg-card border-border/60 shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <X className="w-4 h-4 text-muted-foreground" />
            Forecast Exclusions
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            Medication lines containing any of these substrings (case-insensitive) are automatically dropped from pharmacy forecasts.
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="e.g. fluids"
              value={newExclusion}
              onChange={(e) => setNewExclusion(e.target.value)}
              className="h-8 text-sm max-w-[180px]"
              data-testid="exclusion-substring-input"
            />
            <Input
              placeholder="Note (optional)"
              value={newExclusionNote}
              onChange={(e) => setNewExclusionNote(e.target.value)}
              className="h-8 text-sm max-w-[200px]"
            />
            <Button
              size="sm"
              className="h-8"
              onClick={() => addExclusionMut.mutate()}
              disabled={!newExclusion.trim() || addExclusionMut.isPending}
              data-testid="btn-add-exclusion"
            >
              {addExclusionMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
            </Button>
          </div>
          {excLoading ? (
            <Skeleton className="h-12 w-full" />
          ) : exclusions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No exclusions set.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {exclusions.map((ex: PharmacyForecastExclusion) => (
                <div key={ex.id} className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1 text-xs">
                  <div className="flex flex-col">
                    <span className="font-mono font-medium">{ex.matchSubstring}</span>
                    {ex.note && <span className="text-muted-foreground">{ex.note}</span>}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                    onClick={() => removeExclusionMut.mutate(ex.id)}
                    disabled={removeExclusionMut.isPending}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Drug Form Dialog */}
      <Dialog open={showCreate} onOpenChange={(o) => { if (!o) { setShowCreate(false); setEditEntry(null); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editEntry ? "עריכת תרופה" : "הוספת תרופה"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="col-span-2 flex flex-col gap-1">
              <Label className="text-xs">Brand Name *</Label>
              <Input value={form.name} onChange={f("name")} placeholder="e.g. Propofol 1%" className="h-8 text-sm" />
            </div>
            <div className="col-span-2 flex flex-col gap-1">
              <Label className="text-xs">Generic Name *</Label>
              <Input value={form.genericName} onChange={f("genericName")} placeholder="e.g. Propofol" className="h-8 text-sm" />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Concentration (mg/ml) *</Label>
              <Input type="number" value={form.concentrationMgMl} onChange={f("concentrationMgMl")} className="h-8 text-sm" />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Standard Dose *</Label>
              <Input type="number" value={form.standardDose} onChange={f("standardDose")} className="h-8 text-sm" />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Min Dose</Label>
              <Input type="number" value={form.minDose} onChange={f("minDose")} className="h-8 text-sm" />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Max Dose</Label>
              <Input type="number" value={form.maxDose} onChange={f("maxDose")} className="h-8 text-sm" />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Dose Unit</Label>
              <Select
                value={form.doseUnit}
                onValueChange={(v) => setForm((p) => ({ ...p, doseUnit: v as typeof form.doseUnit }))}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOSE_UNITS.map((u) => (
                    <SelectItem key={u} value={u}>{u.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Route (PO/IV/IM…)</Label>
              <Select
                value={form.defaultRoute ?? FORMULARY_SELECT_NONE}
                onValueChange={(v) =>
                  setForm((p) => ({
                    ...p,
                    defaultRoute: v === FORMULARY_SELECT_NONE ? null : v,
                  }))
                }
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Select route" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FORMULARY_SELECT_NONE}>— None —</SelectItem>
                  {ROUTES.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Form (vial/ampule…)</Label>
              <Select
                value={form.unitType ?? FORMULARY_SELECT_NONE}
                onValueChange={(v) =>
                  setForm((p) => ({
                    ...p,
                    unitType: v === FORMULARY_SELECT_NONE ? null : (v as NonNullable<FormularyFormState["unitType"]>),
                  }))
                }
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Select form" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FORMULARY_SELECT_NONE}>— None —</SelectItem>
                  {UNIT_TYPES.map((u) => (
                    <SelectItem key={u} value={u}>{u}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Volume per unit (ml)</Label>
              <Input type="number" value={form.unitVolumeMl} onChange={f("unitVolumeMl")} placeholder="e.g. 20" className="h-8 text-sm" />
            </div>
            <div className="col-span-2 flex flex-col gap-1">
              <Label className="text-xs">Category</Label>
              <Input value={form.category ?? ""} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value || null }))} className="h-8 text-sm" />
            </div>
            <div className="col-span-2 flex flex-col gap-1">
              <Label className="text-xs">Dosage Notes</Label>
              <Textarea
                value={form.dosageNotes ?? ""}
                onChange={(e) => setForm((p) => ({ ...p, dosageNotes: e.target.value || null }))}
                rows={2}
                className="text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setShowCreate(false); setEditEntry(null); }}>{t.adminPage.cancel}</Button>
            <Button onClick={handleSubmit} disabled={upsertMut.isPending} data-testid="btn-save-formulary">
              {upsertMut.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              {editEntry ? "Update" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ClinicSettingsSection() {
  const queryClient = useQueryClient();
  const [emailInput, setEmailInput] = useState("");
  const [editingEmail, setEditingEmail] = useState(false);
  const [sourceFormatInput, setSourceFormatInput] = useState<"smartflow" | "generic">("smartflow");

  const { data, isLoading } = useQuery({
    queryKey: ["/api/forecast/clinic/pharmacy-email"],
    queryFn: api.forecast.getPharmacyEmail,
  });

  const currentEmail = data?.pharmacyEmail ?? null;
  const currentSourceFormat: "smartflow" | "generic" =
    data?.forecastPdfSourceFormat === "generic" ? "generic" : "smartflow";

  const saveMut = useMutation({
    mutationFn: (payload: { pharmacyEmail: string | null; forecastPdfSourceFormat?: "smartflow" | "generic" }) =>
      api.forecast.setPharmacyEmail(payload),
    onSuccess: (result) => {
      queryClient.setQueryData(["/api/forecast/clinic/pharmacy-email"], result);
      setEditingEmail(false);
      toast.success("הגדרות תחזית נשמרו");
    },
    onError: () => toast.error("שמירת ההגדרות נכשלה"),
  });

  function handleEdit() {
    setEmailInput(currentEmail ?? "");
    setSourceFormatInput(currentSourceFormat);
    setEditingEmail(true);
  }

  function handleSave() {
    const trimmed = emailInput.trim();
    saveMut.mutate({
      pharmacyEmail: trimmed || null,
      forecastPdfSourceFormat: sourceFormatInput,
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="bg-card border-border/60 shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Mail className="w-4 h-4 text-muted-foreground" />
            מייל בית מרקחת ופורמט PDF
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            הזמנות בית מרקחת יישלחו למייל זה. בחרו כאן גם את פורמט מקור ה-PDF לניתוח תחזיות.
          </p>
          {isLoading ? (
            <Skeleton className="h-10 w-full max-w-sm" />
          ) : editingEmail ? (
            <div className="flex flex-col gap-3 max-w-md">
              <Input
                type="email"
                placeholder="pharmacy@example.com"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
                data-testid="pharmacy-email-input"
                autoFocus
              />
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">פורמט מקור PDF</Label>
                <Select
                  value={sourceFormatInput}
                  onValueChange={(value: "smartflow" | "generic") => setSourceFormatInput(value)}
                >
                  <SelectTrigger className="h-9" data-testid="forecast-pdf-source-format-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="smartflow">SmartFlow Flowsheet</SelectItem>
                    <SelectItem value="generic">Generic / Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={saveMut.isPending}
                  data-testid="btn-save-pharmacy-email"
                >
                  {saveMut.isPending && (
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  )}
                  {t.common.save}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditingEmail(false)}
                  disabled={saveMut.isPending}
                >
                  {t.adminPage.cancel}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <span
                  className={
                    currentEmail
                      ? "text-sm font-medium"
                      : "text-sm text-muted-foreground italic"
                  }
                  data-testid="pharmacy-email-display"
                >
                  {currentEmail ?? "לא הוגדר"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                פורמט מקור PDF:{" "}
                <span className="font-medium text-foreground">
                  {currentSourceFormat === "generic" ? "Generic / Other" : "SmartFlow Flowsheet"}
                </span>
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={handleEdit}
                data-testid="btn-edit-pharmacy-email"
              >
                <Pencil className="w-3.5 h-3.5 mr-1" />
                {currentEmail ? "עריכה" : "הגדרת מייל"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
