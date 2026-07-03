import { useParams } from "wouter";
import { TwoPaneLayout } from "@/native/tablet/TwoPaneLayout";
import { SelectItemPlaceholder } from "@/native/tablet/SelectItemPlaceholder";
import InventoryItemsPage from "@/pages/inventory-items";
import InventoryItemDetailPage from "@/pages/inventory-item-detail";
import { t } from "@/lib/i18n";

/**
 * iPad two-pane inventory catalog: the item list stays mounted in the master
 * pane while the `:id` route param swaps the detail. Reached only via the
 * native-tablet combined route `/inventory-items/:id?`. The detail page reads
 * the same `:id` and its "back" navigates to `/inventory-items`, which the
 * combined route resolves to the empty placeholder — i.e. clears the selection
 * without unmounting the master.
 */
export default function InventoryItemsMasterDetail() {
  const { id } = useParams<{ id?: string }>();

  return (
    <TwoPaneLayout
      masterLabel={t.nav.inventoryItems}
      detailLabel={t.inventoryItemDetailPage.title}
      master={<InventoryItemsPage />}
      detail={id ? <InventoryItemDetailPage /> : null}
      placeholder={<SelectItemPlaceholder />}
    />
  );
}
