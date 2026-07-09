import { t } from "@/lib/i18n";

/**
 * Localizes the raw status enums the management-console reads render (webhook events,
 * notification deliveries, restock sessions, purchase orders). Reads `t` lazily (it is a
 * reassignable binding that changes on locale switch). Unknown values fall through raw so
 * a new server status never crashes the badge — it just shows the raw token until keyed.
 */
export function consoleStatusLabel(status: string): string {
  switch (status) {
    case "active":
      return t.console.stActive;
    case "muted":
      return t.console.stMuted;
    case "completed":
      return t.console.stCompleted;
    case "cancelled":
      return t.console.stCancelled;
    case "received":
      return t.console.stReceived;
    case "rejected_signature":
      return t.console.stRejectedSignature;
    case "processed":
      return t.console.stProcessed;
    case "failed":
      return t.console.stFailed;
    case "replay_pending":
      return t.console.stReplayPending;
    case "sent":
      return t.console.stSent;
    case "pending":
      return t.console.stPending;
    case "draft":
      return t.console.stDraft;
    case "ordered":
      return t.console.stOrdered;
    case "partial":
      return t.console.stPartial;
    default:
      return status;
  }
}
