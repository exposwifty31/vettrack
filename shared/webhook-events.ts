/**
 * Admin webhook-event registry row (Phase 7b). The inbound PMS webhook event log,
 * clinic-scoped and read-only. The `payload` jsonb (vendor data, possibly sensitive)
 * is DELIBERATELY absent — the admin list never selects or exposes it. Only the
 * envelope (adapter, status, signature validity, timestamps) crosses the wire.
 */
export type WebhookEventRow = {
  id: string;
  adapterId: string;
  status: string;
  signatureValid: boolean;
  createdAt: string;
  processedAt: string | null;
};
