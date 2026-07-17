import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RadioTower } from "lucide-react";
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
import { formatRelativeTime } from "@/lib/relative-time";
import type { ManagedRfidReaderRow, ManagedReaderHealth, RfidRotationEnvelope } from "@/types";

/** Canonical react-query key for the clinic's MANAGED reader registry. */
const READERS_KEY = ["console", "rfid-readers", "managed"] as const;

/** OWN-heartbeat health → badge label + variant (never derived from asset-read traffic). */
function healthMeta(health: ManagedReaderHealth): { label: string; variant: "ok" | "secondary" | "issue" } {
  switch (health) {
    case "online":
      return { label: t.console.readerOnline, variant: "ok" };
    case "offline":
      return { label: t.console.readerOffline, variant: "issue" };
    case "no_signal":
      return { label: t.console.readerNoSignal, variant: "secondary" };
  }
}

/** Add-reader drawer — registers a gateway as a managed (unconfigured) reader. */
function CreateReaderSheet({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [gatewayCode, setGatewayCode] = useState("");
  const [physicalLocation, setPhysicalLocation] = useState("");

  const mut = useMutation({
    mutationFn: () =>
      api.rfidReaders.create({
        name: name.trim(),
        gatewayCode: gatewayCode.trim(),
        physicalLocation: physicalLocation.trim() || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: READERS_KEY });
      toast.success(t.console.rfidReaders.created);
      onClose();
    },
    onError: (err) =>
      toast.error(
        err instanceof Error && /DUPLICATE_GATEWAY/.test(err.message)
          ? t.console.rfidReaders.duplicateGateway
          : t.console.rfidReaders.createFailed,
      ),
  });

  const canSubmit = name.trim().length > 0 && gatewayCode.trim().length > 0 && !mut.isPending;

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full max-w-md">
        <SheetHeader>
          <SheetTitle>{t.console.rfidReaders.createTitle}</SheetTitle>
          <SheetDescription>{t.console.rfidReaders.createDescription}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 py-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reader-name">{t.console.rfidReaders.nameLabel}</Label>
            <Input id="reader-name" value={name} onChange={(e) => setName(e.target.value)} disabled={mut.isPending} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reader-gateway">{t.console.rfidReaders.gatewayLabel}</Label>
            <Input
              id="reader-gateway"
              dir="ltr"
              value={gatewayCode}
              onChange={(e) => setGatewayCode(e.target.value)}
              disabled={mut.isPending}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reader-location">{t.console.rfidReaders.physicalLocationLabel}</Label>
            <Input
              id="reader-location"
              value={physicalLocation}
              onChange={(e) => setPhysicalLocation(e.target.value)}
              disabled={mut.isPending}
            />
          </div>
        </div>
        <SheetFooter>
          <Button variant="outline" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button onClick={() => mut.mutate()} disabled={!canSubmit}>
            {t.console.rfidReaders.create}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/** Manage drawer — rename or two-step deactivate a managed reader. */
function ManageReaderSheet({ reader, onClose }: { reader: ManagedRfidReaderRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(reader.name);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);
  const isInactive = reader.status !== "active";

  const renameMut = useMutation({
    mutationFn: () => api.rfidReaders.rename(reader.id, name.trim()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: READERS_KEY });
      toast.success(t.console.rfidReaders.renamed);
      onClose();
    },
    onError: () => toast.error(t.console.rfidReaders.renameFailed),
  });

  const deactivateMut = useMutation({
    mutationFn: () => api.rfidReaders.deactivate(reader.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: READERS_KEY });
      toast.success(t.console.rfidReaders.deactivated);
      onClose();
    },
    onError: () => toast.error(t.console.rfidReaders.deactivateFailed),
  });

  const trimmed = name.trim();
  const nameUnchanged = trimmed === reader.name || trimmed.length === 0;

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full max-w-md">
        <SheetHeader>
          <SheetTitle>{t.console.rfidReaders.manageTitle}</SheetTitle>
          <SheetDescription>
            <span dir="ltr" className="font-mono text-xs">
              {reader.gatewayCode}
            </span>
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 py-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reader-rename">{t.console.rfidReaders.nameLabel}</Label>
            <Input
              id="reader-rename"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isInactive || renameMut.isPending}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">{t.console.rfidReaders.colHealth}</span>
            <div>
              <Badge variant={healthMeta(reader.health).variant}>{healthMeta(reader.health).label}</Badge>
            </div>
          </div>
        </div>
        <SheetFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          {!isInactive && (
            <Button onClick={() => renameMut.mutate()} disabled={nameUnchanged || renameMut.isPending}>
              {t.console.rfidReaders.save}
            </Button>
          )}
          {!isInactive &&
            (confirmingDeactivate ? (
              <Button variant="destructive" onClick={() => deactivateMut.mutate()} disabled={deactivateMut.isPending}>
                {t.console.rfidReaders.deactivateConfirm}
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setConfirmingDeactivate(true)}>
                {t.console.rfidReaders.deactivate}
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

/** Reveal dialog — surfaces the freshly-provisioned ingest secret exactly once. */
function ProvisionedSecretDialog({ rotation, onClose }: { rotation: RfidRotationEnvelope; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.console.rfidReaders.provisionTitle}</DialogTitle>
          <DialogDescription>{t.console.rfidReaders.provisionDescription}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-stretch gap-3 py-4">
          <div
            dir="ltr"
            data-testid="provisioned-secret"
            className="break-all rounded-xl border border-border bg-muted px-4 py-3 text-center font-mono text-sm font-semibold"
          >
            {rotation.secret}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * RFID Readers console (R-M1.1e). CRUD over the first-class `vt_rfid_readers` entity:
 * add / rename / deactivate a managed reader, provision (rotate) the per-clinic HMAC
 * ingest secret (revealed once), and pause/resume ingest. Health is the reader's OWN
 * heartbeat (never asset-read traffic). Reads + writes are `requireAdmin`, so a lead
 * (management.web without webWrite) sees the honest pending-server state. RFID is
 * advisory-only (ADR-006): this console never touches custody.
 */
export default function RfidReadersConsolePage() {
  const experience = useExperience();
  const hasServerAccess = experience.can("management.webWrite");
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState<ManagedRfidReaderRow | null>(null);
  const [provisioned, setProvisioned] = useState<RfidRotationEnvelope | null>(null);

  const readersQ = useQuery({
    queryKey: READERS_KEY,
    queryFn: async () => (await api.rfidReaders.listManaged()).readers,
    enabled: hasServerAccess,
    retry: false,
  });

  const provisionMut = useMutation({
    mutationFn: () => api.rfidReaders.provision(crypto.randomUUID()),
    onSuccess: (res) => setProvisioned(res.rotation),
    onError: (err) =>
      toast.error(
        err instanceof Error && /ROTATION_IN_PROGRESS/.test(err.message)
          ? t.console.rfidReaders.provisionInProgress
          : t.console.rfidReaders.provisionFailed,
      ),
  });

  const ingestMut = useMutation({
    mutationFn: (enabled: boolean) => api.rfidReaders.setIngest(enabled),
    onSuccess: (res) =>
      toast.success(res.enabled ? t.console.rfidReaders.ingestEnabled : t.console.rfidReaders.ingestDisabled),
    onError: () => toast.error(t.console.rfidReaders.ingestFailed),
  });

  const columns = useMemo<Column<ManagedRfidReaderRow>[]>(
    () => [
      {
        key: "name",
        header: t.console.colName,
        sortValue: (r) => r.name,
        cell: (r) => <Bdi className="font-medium">{r.name}</Bdi>,
      },
      {
        key: "gateway",
        header: t.console.colGateway,
        sortValue: (r) => r.gatewayCode,
        cell: (r) => <span className="font-mono text-xs font-medium">{r.gatewayCode}</span>,
      },
      {
        key: "health",
        header: t.console.rfidReaders.colHealth,
        sortValue: (r) => r.health,
        cell: (r) => {
          const h = healthMeta(r.health);
          return <Badge variant={h.variant}>{h.label}</Badge>;
        },
      },
      {
        key: "lifecycle",
        header: t.console.colStatus,
        sortValue: (r) => r.status,
        cell: (r) => (
          <Badge variant={r.status === "active" ? "secondary" : "issue"}>
            {r.status === "active" ? t.console.rfidReaders.lifecycleActive : t.console.rfidReaders.lifecycleInactive}
          </Badge>
        ),
      },
      {
        key: "lastSeen",
        header: t.console.colLastSeen,
        sortValue: (r) => r.lastSeenAt ?? "",
        cell: (r) =>
          r.lastSeenAt ? (
            formatRelativeTime(new Date(r.lastSeenAt))
          ) : (
            <span className="text-muted-foreground">{t.console.valNever}</span>
          ),
      },
    ],
    [],
  );

  // Keep an open drawer in sync with background refetches by re-deriving from live data.
  const managedReader = managing ? (readersQ.data?.find((r) => r.id === managing.id) ?? managing) : null;

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-foreground">{t.console.rfidReaders.title}</h1>
            <p className="text-sm text-muted-foreground">{t.console.rfidReaders.subtitle}</p>
          </div>
          {hasServerAccess && (
            <Button onClick={() => setCreating(true)}>{t.console.rfidReaders.addReader}</Button>
          )}
        </header>

        {hasServerAccess ? (
          <>
            <section className="rounded-lg border border-border p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <h2 className="text-sm font-semibold text-foreground">{t.console.rfidReaders.ingestSection}</h2>
                  <p className="text-xs text-muted-foreground">{t.console.rfidReaders.ingestSectionHelp}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => ingestMut.mutate(true)}
                    disabled={ingestMut.isPending}
                  >
                    {t.console.rfidReaders.ingestEnable}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => ingestMut.mutate(false)}
                    disabled={ingestMut.isPending}
                  >
                    {t.console.rfidReaders.ingestDisable}
                  </Button>
                  <Button onClick={() => provisionMut.mutate()} disabled={provisionMut.isPending}>
                    {provisionMut.isPending
                      ? t.console.rfidReaders.provisioning
                      : t.console.rfidReaders.provisionSecret}
                  </Button>
                </div>
              </div>
            </section>

            <DataTable
              columns={columns}
              rows={readersQ.data}
              rowKey={(r) => r.id}
              isLoading={readersQ.isLoading}
              isError={readersQ.isError}
              onRetry={() => readersQ.refetch()}
              emptyIcon={RadioTower}
              emptyMessage={t.console.state.empty}
              onRowClick={(r) => setManaging(r)}
            />
          </>
        ) : (
          <EmptyState icon={RadioTower} message={t.console.accessPendingServer} />
        )}
      </div>
      {creating && <CreateReaderSheet onClose={() => setCreating(false)} />}
      {managedReader && <ManageReaderSheet reader={managedReader} onClose={() => setManaging(null)} />}
      {provisioned && <ProvisionedSecretDialog rotation={provisioned} onClose={() => setProvisioned(null)} />}
    </AppShell>
  );
}
