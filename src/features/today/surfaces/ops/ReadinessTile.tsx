import { Link } from "wouter";
import { DoorOpen } from "lucide-react";
import { Bdi } from "@/components/ui/bdi";
import { t } from "@/lib/i18n";
import { OpsTile, TileHeader, SkeletonRows, pctColor } from "./ops-tile-helpers";
import type { Room } from "@/types";

/**
 * Ops room-readiness tile — worst-5 verification % bars (reimplemented from
 * HomeTabletDashboard). The fill fills from the inline-start (RTL-correct) and is
 * tier-colored by the same {@link pctColor} scale the coverage card uses — one
 * color language across the surface.
 */
export function ReadinessTile({
  worstRooms,
  isLoading,
}: {
  worstRooms: { room: Room; pct: number }[];
  isLoading: boolean;
}) {
  return (
    <OpsTile testId="ops-readiness-tile">
      <TileHeader title={t.homeSurface.roomReadiness} href="/rooms" />
      {isLoading ? (
        <SkeletonRows rows={4} />
      ) : worstRooms.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-ivory-text3">
          <DoorOpen className="h-4 w-4" aria-hidden />
          {t.roomsListPage.healthRingHelp}
        </p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {worstRooms.map(({ room, pct }) => (
            <Link
              key={room.id}
              href={`/rooms/${room.id}`}
              className="flex min-h-8 items-center gap-2.5"
              title={t.roomsListPage.healthRingTitle(pct)}
            >
              <span className="w-[34%] min-w-0 truncate text-sm font-semibold text-ivory-text">
                <Bdi>{room.name}</Bdi>
              </span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${pct}%`, background: pctColor(pct) }}
                />
              </span>
              <span
                dir="ltr"
                className="w-[42px] shrink-0 text-end font-num text-sm font-bold tabular-nums"
                style={{ color: pctColor(pct) }}
              >
                {pct}%
              </span>
            </Link>
          ))}
        </div>
      )}
    </OpsTile>
  );
}
