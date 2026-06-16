import { toast } from "sonner";
import { t } from "@/lib/i18n";

interface ToastResultMessages {
  /** Success toast. Defaults to the shared "Saved" toast. */
  success?: string;
  /** Error toast. Defaults to the shared "Something went wrong" toast. */
  error?: string;
}

/**
 * Wraps an async action with standard success / error toast feedback so every
 * mutation (auto-save, restore, report) gives the user a visible result instead
 * of failing silently.
 *
 * Returns the action's resolved value, or `undefined` if it threw (after the
 * error toast). Re-throw inside the caller if you need to branch on failure.
 */
export async function withToast<T>(
  action: () => Promise<T>,
  messages: ToastResultMessages = {},
): Promise<T | undefined> {
  try {
    const result = await action();
    toast.success(messages.success ?? t.common.toast.savedSuccess);
    return result;
  } catch {
    toast.error(messages.error ?? t.common.toast.unexpectedError);
    return undefined;
  }
}
