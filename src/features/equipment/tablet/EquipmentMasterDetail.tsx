import { useEffect } from "react";
import { useLocation, useParams, useSearch } from "wouter";
import { TwoPaneLayout } from "@/native/tablet/TwoPaneLayout";
import { SelectItemPlaceholder } from "@/native/tablet/SelectItemPlaceholder";
import { PageErrorBoundary } from "@/components/ui/page-error-boundary";
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
  const searchStr = useSearch();
  const [, navigate] = useLocation();

  // Same deep-link forward as EquipmentListPage (Phase 7 #5): the scanner is
  // its own surface on the tablet too, so /equipment?scan=1 (vettrack://scan,
  // /equipment/scan alias) must not strand on the master-detail list.
  const wantsScan = new URLSearchParams(searchStr).get("scan") === "1";
  useEffect(() => {
    if (wantsScan) navigate("/scan", { replace: true });
  }, [wantsScan, navigate]);
  if (wantsScan) return null;

  return (
    <TwoPaneLayout
      masterLabel={t.nav.equipment}
      detailLabel={t.equipmentDetail.atGlance}
      master={
        <PageErrorBoundary>
          <EquipmentListScreen />
        </PageErrorBoundary>
      }
      detail={
        id ? (
          <PageErrorBoundary key={id}>
            <EquipmentDetailScreen equipmentId={id} hideBack />
          </PageErrorBoundary>
        ) : null
      }
      placeholder={<SelectItemPlaceholder />}
    />
  );
}
