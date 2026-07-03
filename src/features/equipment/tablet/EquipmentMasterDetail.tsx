import { useParams } from "wouter";
import { TwoPaneLayout } from "@/native/tablet/TwoPaneLayout";
import { SelectItemPlaceholder } from "@/native/tablet/SelectItemPlaceholder";
import { EquipmentListScreen, EquipmentDetailScreen } from "@/features/equipment";
import { t } from "@/lib/i18n";

/**
 * iPad two-pane Equipment: the list stays mounted in the master pane while the
 * `:id` route param swaps the detail pane. Reached only via the native-tablet
 * combined route `/equipment/:id?` (see routes.tsx); phone/web keep the separate
 * list + detail routes with full push navigation.
 */
export default function EquipmentMasterDetail() {
  const { id } = useParams<{ id?: string }>();

  return (
    <TwoPaneLayout
      masterLabel={t.nav.equipment}
      detailLabel={t.equipmentDetail.atGlance}
      master={<EquipmentListScreen />}
      detail={id ? <EquipmentDetailScreen equipmentId={id} hideBack /> : null}
      placeholder={<SelectItemPlaceholder />}
    />
  );
}
