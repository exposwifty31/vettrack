import { RadioTower } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { t } from "@/lib/i18n";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * RFID Readers console (Phase 6 scaffold). No reader entity/GET exists server-side —
 * a reader registry must be derived (rooms.gatewayCode + last equipment read), which
 * needs a new read endpoint — Q4. That lands in Phase 7; render chrome + pending state.
 */
export default function RfidReadersConsolePage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold text-foreground">{t.console.rfidReaders.title}</h1>
          <p className="text-sm text-muted-foreground">{t.console.rfidReaders.subtitle}</p>
        </header>
        <EmptyState icon={RadioTower} message={t.console.pendingEndpoint} />
      </div>
    </AppShell>
  );
}
