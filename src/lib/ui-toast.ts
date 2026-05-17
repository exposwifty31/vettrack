import { toast } from "sonner";

/**
 * Phase 6 PR 6.4 — canonical client toast wrappers.
 *
 * Thin wrappers over `sonner`'s `toast.success` / `toast.error` that
 * enforce a `string` message argument. Callers pass an already-resolved
 * `t.x.y` accessor value; the message never leaks as a raw literal in
 * adopting components (see Phase 6 §5 invariant 1 — banned-Hebrew rule).
 *
 * Signatures are intentionally minimal and locked: `(message: string,
 * opts?)`. PR 6.14's typed `t` generator will catch `toastSuccess(t.x.y)`
 * call sites where `t.x.y` is not a valid leaf key.
 */
export type ToastOptions = Parameters<typeof toast.success>[1];

export function toastSuccess(message: string, opts?: ToastOptions): ReturnType<typeof toast.success> {
  return toast.success(message, opts);
}

export function toastError(message: string, opts?: ToastOptions): ReturnType<typeof toast.error> {
  return toast.error(message, opts);
}
