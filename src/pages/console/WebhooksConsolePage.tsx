import { Webhook } from "lucide-react";
import { PendingConsolePage } from "@/desktop/management";
import { t } from "@/lib/i18n";

/**
 * Webhooks console (Phase 6 scaffold). No `GET` list of inbound PMS webhook events
 * exists server-side yet (only per-event replay) — Q2. The data + endpoint land in
 * Phase 7; here the module renders its headless chrome + an honest pending state.
 */
export default function WebhooksConsolePage() {
  return (
    <PendingConsolePage
      icon={Webhook}
      title={t.console.webhooks.title}
      subtitle={t.console.webhooks.subtitle}
    />
  );
}
