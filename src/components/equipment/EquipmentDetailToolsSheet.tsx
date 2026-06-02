import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import type { Equipment, EquipmentStatus } from "@/types";
import { buildWhatsAppUrl } from "@/lib/utils";
import { MessageCircle, QrCode, Nfc } from "lucide-react";

interface EquipmentDetailToolsSheetProps {
  equipment: Equipment;
  equipmentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPrintQr: () => void;
  onWriteNfc?: () => void;
  showWhatsApp: boolean;
  showWriteNfc: boolean;
}

export function EquipmentDetailToolsSheet({
  equipment,
  open,
  onOpenChange,
  onPrintQr,
  onWriteNfc,
  showWhatsApp,
  showWriteNfc,
}: EquipmentDetailToolsSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>{t.equipmentDetail.toolsSheetTitle}</SheetTitle>
        </SheetHeader>
        <div className="mt-4 flex flex-col gap-2 pb-6">
          <Button variant="outline" className="h-12 justify-start" onClick={onPrintQr}>
            <QrCode className="w-4 h-4 me-2" />
            {t.equipmentDetail.printQrButton}
          </Button>
          {showWriteNfc && onWriteNfc && (
            <Button variant="outline" className="h-12 justify-start" onClick={onWriteNfc}>
              <Nfc className="w-4 h-4 me-2" />
              {t.equipmentNfc.writeTag}
            </Button>
          )}
          {showWhatsApp && (
            <Button
              variant="outline"
              className="h-12 justify-start text-green-700 border-green-200"
              onClick={() => {
                const waUrl = buildWhatsAppUrl(
                  undefined,
                  equipment.name,
                  equipment.status as EquipmentStatus,
                  t.whatsAppMessage.statusReport(equipment.name),
                  t.whatsAppMessage,
                );
                window.open(waUrl, "_blank");
              }}
            >
              <MessageCircle className="w-4 h-4 me-2" />
              {t.equipmentDetail.sendWhatsApp}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
