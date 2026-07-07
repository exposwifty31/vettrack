import { Webhook } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { t } from "@/lib/i18n";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Webhooks console (Phase 6 scaffold). No `GET` list of inbound PMS webhook events
 * exists server-side yet (only per-event replay) — Q2. The data + endpoint land in
 * Phase 7; here the module renders its headless chrome + an honest pending state.
 */
export default function WebhooksConsolePage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold text-foreground">{t.console.webhooks.title}</h1>
          <p className="text-sm text-muted-foreground">{t.console.webhooks.subtitle}</p>
        </header>
        <EmptyState icon={Webhook} message={t.console.pendingEndpoint} />
      </div>
    </AppShell>
  );
}
