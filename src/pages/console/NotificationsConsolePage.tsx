import { BellRing } from "lucide-react";
import { PendingConsolePage } from "@/desktop/management";
import { t } from "@/lib/i18n";

/**
 * Notifications console (Phase 6 scaffold). No admin list of WhatsApp alerts / push
 * subscriptions exists server-side (push endpoints are self-scoped) — Q3. The admin
 * delivery roster + endpoint land in Phase 7; render headless chrome + pending state.
 */
export default function NotificationsConsolePage() {
  return (
    <PendingConsolePage
      icon={BellRing}
      title={t.console.notifications.title}
      subtitle={t.console.notifications.subtitle}
    />
  );
}
