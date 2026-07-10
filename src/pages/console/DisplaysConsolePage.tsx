import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MonitorSmartphone } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { DisplayDevice, DisplayPairingCode } from "@/types";

/** Canonical react-query key for the clinic's paired display registry. */
const DEVICES_KEY = ["/api/display/devices"] as const;

// The registry is a live operational view: a device pairs on a DIFFERENT display
// and heartbeats its `lastSeenAt` from there, so the admin list must refresh on
// its own to reflect new pairs (F7) and liveness (F8) without a manual reload.
// This is an admin-console poll, not the emergency realtime path.
const DEVICES_REFETCH_MS = 15_000;

function statusMeta(device: DisplayDevice): { label: string; variant: "ok" | "issue" } {
  return device.revokedAt
    ? { label: t.console.displays.statusRevoked, variant: "issue" }
    : { label: t.console.displays.statusActive, variant: "ok" };
}

/** Manage drawer — rename an active device or revoke it. Both are two-step guarded. */
function ManageDeviceSheet({ device, onClose }: { device: DisplayDevice; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(device.name);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const isRevoked = device.revokedAt != null;

  const renameMut = useMutation({
    mutationFn: () => api.display.devices.rename(device.id, name.trim()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DEVICES_KEY });
      toast.success(t.console.displays.renamed);
      onClose();
    },
    onError: () => toast.error(t.console.displays.renameError),
  });

  const revokeMut = useMutation({
    mutationFn: () => api.display.devices.revoke(device.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DEVICES_KEY });
      toast.success(t.console.displays.revoked);
      onClose();
    },
    onError: () => toast.error(t.console.displays.revokeError),
  });

  const trimmed = name.trim();
  const nameUnchanged = trimmed === device.name || trimmed.length === 0;

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full max-w-md">
        <SheetHeader>
          <SheetTitle>{t.console.displays.manageTitle}</SheetTitle>
          <SheetDescription>
            <Bdi>{device.name}</Bdi>
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 py-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="display-name">{t.console.displays.nameLabel}</Label>
            <Input
              id="display-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={isRevoked || renameMut.isPending}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">{t.console.colStatus}</span>
            <div>
              <Badge variant={statusMeta(device).variant}>{statusMeta(device).label}</Badge>
            </div>
          </div>
        </div>
        <SheetFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          {!isRevoked && (
            <Button
              onClick={() => renameMut.mutate()}
              disabled={nameUnchanged || renameMut.isPending}
            >
              {t.console.displays.save}
            </Button>
          )}
          {!isRevoked &&
            (confirmingRevoke ? (
              <Button
                variant="destructive"
                onClick={() => revokeMut.mutate()}
                disabled={revokeMut.isPending}
              >
                {t.console.displays.revokeConfirm}
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setConfirmingRevoke(true)}>
                {t.console.displays.revoke}
              </Button>
            ))}
          <Button variant="ghost" onClick={onClose}>
            {t.common.cancel}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/** Issued-code dialog — surfaces the short-lived code to type into the display at /board/pair. */
function IssuedCodeDialog({ issued, onClose }: { issued: DisplayPairingCode; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.console.displays.issueDialogTitle}</DialogTitle>
          <DialogDescription>{t.console.displays.issueDialogDescription}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3 py-4">
          <div
            dir="ltr"
            data-testid="issued-pairing-code"
            className="rounded-xl border border-border bg-muted px-6 py-4 text-center font-mono text-3xl font-bold tracking-[0.3em]"
          >
            {issued.code}
          </div>
          <p className="text-xs text-muted-foreground">
            {t.console.displays.codeExpires} {new Date(issued.expiresAt).toLocaleTimeString()}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Displays console (Phase 9) — the admin registry for paired Department Display
 * devices. Reads + writes are `requireAuth + requireAdmin` server-side, so a lead
 * (management.web, no webWrite) sees the chrome + an honest "pending server
 * enablement" state rather than a 403'd fetch. Issue pairing codes, rename, and
 * revoke devices; the token is never listed.
 */
export default function DisplaysConsolePage() {
  const experience = useExperience();
  const hasServerAccess = experience.can("management.webWrite");
  const [managing, setManaging] = useState<DisplayDevice | null>(null);
  const [issuedCode, setIssuedCode] = useState<DisplayPairingCode | null>(null);

  const devicesQ = useQuery({
    queryKey: DEVICES_KEY,
    queryFn: () => api.display.devices.list(),
    enabled: hasServerAccess,
    retry: false,
    refetchInterval: DEVICES_REFETCH_MS,
    refetchOnWindowFocus: true,
  });

  const issueMut = useMutation({
    mutationFn: () => api.display.pairIssue(),
    onSuccess: (issued) => setIssuedCode(issued),
    onError: () => toast.error(t.console.displays.issueError),
  });

  const columns = useMemo<Column<DisplayDevice>[]>(
    () => [
      {
        key: "name",
        header: t.console.colName,
        sortValue: (d) => d.name,
        cell: (d) => <Bdi className="font-medium">{d.name}</Bdi>,
      },
      {
        key: "lastSeen",
        header: t.console.displays.colLastSeen,
        sortValue: (d) => d.lastSeenAt ?? "",
        cell: (d) => (
          <span className="text-muted-foreground">
            {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : t.console.valNever}
          </span>
        ),
      },
      {
        key: "status",
        header: t.console.colStatus,
        sortValue: (d) => (d.revokedAt ? "revoked" : "active"),
        cell: (d) => {
          const s = statusMeta(d);
          return <Badge variant={s.variant}>{s.label}</Badge>;
        },
      },
    ],
    [],
  );

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-foreground">{t.console.displays.title}</h1>
            <p className="text-sm text-muted-foreground">{t.console.displays.subtitle}</p>
          </div>
          {hasServerAccess && (
            <Button onClick={() => issueMut.mutate()} disabled={issueMut.isPending}>
              {issueMut.isPending ? t.console.displays.issuing : t.console.displays.issueCode}
            </Button>
          )}
        </header>
        {hasServerAccess ? (
          <DataTable
            columns={columns}
            rows={devicesQ.data}
            rowKey={(d) => d.id}
            isLoading={devicesQ.isLoading}
            isError={devicesQ.isError}
            onRetry={() => devicesQ.refetch()}
            emptyIcon={MonitorSmartphone}
            emptyMessage={t.console.displays.empty}
            onRowClick={(d) => setManaging(d)}
          />
        ) : (
          <EmptyState icon={MonitorSmartphone} message={t.console.accessPendingServer} />
        )}
      </div>
      {managing && <ManageDeviceSheet device={managing} onClose={() => setManaging(null)} />}
      {issuedCode && <IssuedCodeDialog issued={issuedCode} onClose={() => setIssuedCode(null)} />}
    </AppShell>
  );
}
