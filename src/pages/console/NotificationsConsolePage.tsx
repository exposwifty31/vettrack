import { BellRing } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { t } from "@/lib/i18n";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Notifications console (Phase 6 scaffold). No admin list of WhatsApp alerts / push
 * subscriptions exists server-side (push endpoints are self-scoped) — Q3. The admin
 * delivery roster + endpoint land in Phase 7; render headless chrome + pending state.
 */
export default function NotificationsConsolePage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold text-foreground">{t.console.notifications.title}</h1>
          <p className="text-sm text-muted-foreground">{t.console.notifications.subtitle}</p>
        </header>
        <EmptyState icon={BellRing} message={t.console.pendingEndpoint} />
      </div>
    </AppShell>
  );
}
