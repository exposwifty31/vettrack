/**
 * In-app account deletion dialog (App Store Guideline 5.1.1(v)).
 *
 * Friction-gated: the user must type the confirmation word before the destructive
 * action enables. On confirm it calls `DELETE /api/users/delete-account` (which
 * revokes the user's Sign in with Apple token, erases their data, and deletes the
 * Clerk user), then signs out and redirects to the signed-out state.
 */
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { t } from "@/lib/i18n";
import { deleteOwnAccount } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

interface DeleteAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeleteAccountDialog({ open, onOpenChange }: DeleteAccountDialogProps) {
  const { signOut } = useAuth();
  const [confirmText, setConfirmText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const confirmWord = t.settingsPage.deleteAccountConfirmWord;
  const canConfirm = confirmText.trim() === confirmWord && !submitting;

  function handleOpenChange(next: boolean) {
    if (submitting) return; // don't allow closing mid-deletion
    if (!next) setConfirmText("");
    onOpenChange(next);
  }

  async function handleDelete() {
    if (!canConfirm) return;
    setSubmitting(true);
    try {
      await deleteOwnAccount();
      toast.success(t.settingsPage.deleteAccountSuccess);
      // signOut clears local session and redirects to the signed-out state.
      await signOut();
    } catch {
      setSubmitting(false);
      toast.error(t.settingsPage.deleteAccountFailed);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-destructive" aria-hidden />
            {t.settingsPage.deleteAccountDialogTitle}
          </DialogTitle>
          <DialogDescription>{t.settingsPage.deleteAccountDialogDescription}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">{t.settingsPage.deleteAccountSubscriptionNote}</p>

          <div className="space-y-1.5">
            <label htmlFor="delete-account-confirm" className="text-sm text-foreground">
              {t.settingsPage.deleteAccountConfirmPrompt}{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">{confirmWord}</code>
            </label>
            <Input
              id="delete-account-confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={t.settingsPage.deleteAccountConfirmPlaceholder}
              disabled={submitting}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              data-testid="delete-account-confirm-input"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}
            data-testid="delete-account-cancel"
          >
            {t.common.cancel}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={!canConfirm}
            className="gap-2"
            data-testid="delete-account-confirm-btn"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                {t.settingsPage.deleteAccountInProgress}
              </>
            ) : (
              t.settingsPage.deleteAccountConfirmButton
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
