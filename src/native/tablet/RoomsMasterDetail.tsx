import { useParams } from "wouter";
import { TwoPaneLayout } from "@/native/tablet/TwoPaneLayout";
import { SelectItemPlaceholder } from "@/native/tablet/SelectItemPlaceholder";
import RoomsListPage from "@/pages/rooms-list";
import RoomRadarPage from "@/pages/room-radar";
import { t } from "@/lib/i18n";

/**
 * iPad two-pane Rooms: the room list (single-column in the narrow master pane)
 * stays mounted while the `:id` route param swaps the room radar detail.
 * Reached only via the native-tablet combined routes `/rooms/:id?` and
 * `/locations/:id?`. `RoomRadarPage` reads the shared `:id`; its "back" →
 * `/rooms` resolves to the placeholder (clears selection, master stays).
 */
export default function RoomsMasterDetail() {
  const { id } = useParams<{ id?: string }>();

  return (
    <TwoPaneLayout
      masterLabel={t.nav.rooms}
      master={<RoomsListPage singleColumn />}
      detail={id ? <RoomRadarPage /> : null}
      placeholder={
        <SelectItemPlaceholder
          title={t.roomsListPage.selectRoomTitle}
          subtitle={t.roomsListPage.selectRoomSubtitle}
        />
      }
    />
  );
}
