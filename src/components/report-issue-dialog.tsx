import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Bug } from "lucide-react";
import { toast } from "sonner";
import type { SupportTicketSeverity } from "@/types";
import { t } from "@/lib/i18n";

interface ReportIssueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ReportIssueDialog({ open, onOpenChange }: ReportIssueDialogProps) {
  const { email } = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<SupportTicketSeverity>("medium");

  const submitMut = useMutation({
    mutationFn: () =>
      api.support.create({
        title,
        description,
        severity,
        pageUrl: window.location.href,
        deviceInfo: navigator.userAgent,
        appVersion: typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : undefined,
      }),
    onSuccess: () => {
      toast.success(t.reportIssueDialog.toast.reported);
      setTitle("");
      setDescription("");
      setSeverity("medium");
      onOpenChange(false);
    },
    onError: () => {
      toast.error(t.reportIssueDialog.toast.submitFailed);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) return;
    submitMut.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bug className="w-4 h-4 text-primary" />
            {t.reportIssueDialog.title}
          </DialogTitle>
          <DialogDescription className="sr-only">{t.reportIssueDialog.description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="issue-title">{t.reportIssueDialog.fields.title.label}</Label>
            <Input
              id="issue-title"
              placeholder={t.reportIssueDialog.fields.title.placeholder}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              data-testid="input-issue-title"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="issue-description">{t.reportIssueDialog.fields.description.label}</Label>
            <Textarea
              id="issue-description"
              placeholder={t.reportIssueDialog.fields.description.placeholder}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid="input-issue-description"
              rows={4}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="issue-severity">{t.reportIssueDialog.fields.severity.label}</Label>
            <Select value={severity} onValueChange={(v) => setSeverity(v as SupportTicketSeverity)}>
              <SelectTrigger id="issue-severity" data-testid="select-issue-severity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">{t.reportIssueDialog.fields.severity.low}</SelectItem>
                <SelectItem value="medium">{t.reportIssueDialog.fields.severity.medium}</SelectItem>
                <SelectItem value="high">{t.reportIssueDialog.fields.severity.high}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {email && (
            <p className="text-xs text-muted-foreground">
              {t.reportIssueDialog.reportedAsPrefix} <span className="font-medium">{email}</span>
            </p>
          )}
          <DialogFooter className="pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitMut.isPending}
            >
              {t.common.cancel}
            </Button>
            <Button
              type="submit"
              disabled={!title.trim() || !description.trim() || submitMut.isPending}
              data-testid="btn-submit-issue"
            >
              {submitMut.isPending && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
              {t.reportIssueDialog.actions.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
