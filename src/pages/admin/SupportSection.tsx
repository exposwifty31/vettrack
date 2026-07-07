import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { Label } from "@/components/ui/label";
import { Bdi } from "@/components/ui/bdi";
import { TruncatedText } from "@/components/ui/truncated-text";
import { LifeBuoy, Loader2, Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import type { SupportTicket, SupportTicketStatus } from "@/types";
import { t, formatDateByLocale } from "@/lib/i18n";

const SEVERITY_STYLES: Record<string, string> = {
  low: "bg-primary/5 text-primary border border-primary/25",
  medium: "bg-muted/80 text-foreground border border-[var(--status-stale-border)]",
  high: "bg-destructive/10 text-destructive border border-destructive/20",
};

const STATUS_STYLES: Record<string, string> = {
  open: "bg-destructive/10 text-destructive border border-destructive/20",
  in_progress: "bg-muted/80 text-foreground border border-[var(--status-stale-border)]",
  resolved: "bg-status-ok/10 text-status-ok border border-status-ok/25",
};

const STATUS_LABELS: Record<string, string> = {
  open: t.adminPage.ticketStatusOpen,
  in_progress: t.adminPage.ticketStatusInProgress,
  resolved: t.adminPage.ticketStatusResolved,
};

const SEVERITY_LABELS: Record<string, string> = {
  low: t.adminPage.severityLow,
  medium: t.adminPage.severityMedium,
  high: t.adminPage.severityHigh,
};

export function SupportSection() {
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

  const { data: cursorBugFixerConfig } = useQuery({
    queryKey: ["/api/admin/cursor-bug-fixer/config"],
    queryFn: api.cursorBugFixer.getConfig,
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const cursorBugFixerReady =
    cursorBugFixerConfig?.enabled === true &&
    cursorBugFixerConfig.apiKeyConfigured === true &&
    cursorBugFixerConfig.repoUrlConfigured === true;

  const dispatchCursorMut = useMutation({
    mutationFn: (ticketId: string) => api.cursorBugFixer.dispatchFromTicket(ticketId),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/support"] });
      toast.success(t.adminPage.cursorBugFixerDispatched);
      if (result.agentUrl) {
        window.open(result.agentUrl, "_blank", "noopener,noreferrer");
      }
    },
    onError: () => toast.error(t.adminPage.cursorBugFixerFailed),
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
              // Row is a non-interactive container so the "Resolve" button is not
              // nested inside another button (invalid interactive nesting). The
              // ticket-info area is the clickable "open detail" control.
              <div
                key={ticket.id}
                className="flex items-start justify-between p-3 bg-muted/50 rounded-xl border border-border hover:bg-muted/50 transition-colors w-full gap-3"
              >
                <button
                  type="button"
                  onClick={() => openDetail(ticket)}
                  data-testid={`ticket-row-${ticket.id}`}
                  className="flex-1 min-w-0 text-left"
                >
                  <TruncatedText text={ticket.title} className="text-sm font-medium" as="p" />
                  <Bdi dir="ltr">
                    <TruncatedText text={ticket.userEmail} className="text-xs text-muted-foreground" as="p" />
                  </Bdi>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatDateByLocale(ticket.createdAt)}
                  </p>
                </button>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[10px]"
                    onClick={() =>
                      updateMut.mutate({
                        id: ticket.id,
                        status: "resolved",
                        adminNote: ticket.adminNote || "",
                      })
                    }
                    disabled={updateMut.isPending || ticket.status === "resolved"}
                  >
                    {t.adminPage.ticketResolve}
                  </Button>
                  <span
                    className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded border font-medium uppercase",
                      SEVERITY_STYLES[ticket.severity],
                    )}
                  >
                    {SEVERITY_LABELS[ticket.severity] ?? ticket.severity}
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
              </div>
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
                  {SEVERITY_LABELS[selectedTicket.severity] ?? selectedTicket.severity}
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
                  {t.adminPage.ticketDescription}
                </p>
                <p className="text-sm whitespace-pre-wrap">
                  {selectedTicket.description}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div>
                  <span className="font-semibold text-muted-foreground">
                    {t.adminPage.ticketSubmittedBy}
                  </span>
                  <Bdi dir="ltr">
                    <TruncatedText text={selectedTicket.userEmail} className="text-sm" as="p" />
                  </Bdi>
                </div>
                <div>
                  <span className="font-semibold text-muted-foreground">
                    {t.adminPage.ticketDate}
                  </span>
                  <p>{new Date(selectedTicket.createdAt).toLocaleString()}</p>
                </div>
                {selectedTicket.pageUrl && (
                  <div className="col-span-2">
                    <span className="font-semibold text-muted-foreground">
                      {t.adminPage.ticketPageUrl}
                    </span>
                    <TruncatedText text={selectedTicket.pageUrl} className="text-sm" as="p" />
                  </div>
                )}
                {selectedTicket.appVersion && (
                  <div>
                    <span className="font-semibold text-muted-foreground">
                      {t.adminPage.ticketAppVersion}
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
                    {t.adminPage.ticketDeviceInfo}
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
                  {t.adminPage.ticketAdminActions}
                </p>
                {cursorBugFixerReady && (
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full justify-start gap-2"
                    data-testid="btn-dispatch-cursor-bug-fixer"
                    disabled={
                      dispatchCursorMut.isPending ||
                      selectedTicket.status === "resolved"
                    }
                    onClick={() => dispatchCursorMut.mutate(selectedTicket.id)}
                  >
                    {dispatchCursorMut.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Sparkles className="w-4 h-4" />
                    )}
                    {dispatchCursorMut.isPending
                      ? t.adminPage.dispatchingCursorBugFixer
                      : t.adminPage.dispatchCursorBugFixer}
                  </Button>
                )}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ticket-status" className="text-xs">
                    {t.adminPage.ticketStatusLabel}
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
                    {t.adminPage.ticketInternalNote}
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
                {t.common.close}
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
                  <Loader2 className="w-4 h-4 me-2 animate-spin" />
                )}
                {t.common.save}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </Card>
  );
}
