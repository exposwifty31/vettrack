import type { ElementType } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/ui/empty-state";
import { t } from "@/lib/i18n";

interface PendingConsolePageProps {
  icon: ElementType;
  title: string;
  subtitle: string;
}

/**
 * Shared scaffold for Phase 6 console modules whose server read endpoint doesn't
 * exist yet (webhooks list / notifications roster / RFID reader registry — Q2–Q4).
 * Renders the headless chrome + an honest "pending endpoint" state; Phase 7 swaps
 * each caller for its real data surface. Centralized so those future skeletons stay
 * consistent by construction rather than by triplicated markup.
 */
export function PendingConsolePage({ icon, title, subtitle }: PendingConsolePageProps) {
  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </header>
        <EmptyState icon={icon} message={t.console.pendingEndpoint} />
      </div>
    </AppShell>
  );
}
