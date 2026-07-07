import { RadioTower } from "lucide-react";
import { PendingConsolePage } from "@/desktop/management";
import { t } from "@/lib/i18n";

/**
 * RFID Readers console (Phase 6 scaffold). No reader entity/GET exists server-side —
 * a reader registry must be derived (rooms.gatewayCode + last equipment read), which
 * needs a new read endpoint — Q4. That lands in Phase 7; render chrome + pending state.
 */
export default function RfidReadersConsolePage() {
  return (
    <PendingConsolePage
      icon={RadioTower}
      title={t.console.rfidReaders.title}
      subtitle={t.console.rfidReaders.subtitle}
    />
  );
}
