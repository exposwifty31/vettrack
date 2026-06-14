import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { t } from "@/lib/i18n";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { DoorOpen, Loader2, Radar } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface EquipmentRoomSweepSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EquipmentRoomSweepSheet({ open, onOpenChange }: EquipmentRoomSweepSheetProps) {
  const queryClient = useQueryClient();
  const { userId } = useAuth();
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);

  const { data: rooms, isLoading } = useQuery({
    queryKey: ["/api/rooms"],
    queryFn: api.rooms.list,
    enabled: !!userId && open,
    staleTime: 60_000,
  });

  const sweepMut = useMutation({
    mutationFn: (roomId: string) => api.rooms.bulkVerify(roomId),
    onSuccess: (result) => {
      toast.success(t.equipmentTruth.roomSweepDone(result.roomName, result.affected));
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rooms"] });
      queryClient.invalidateQueries({ queryKey: ["equipment-truth"] });
      setActiveRoomId(null);
      onOpenChange(false);
    },
    onError: () => {
      toast.error(t.equipmentTruth.roomSweepFailed);
      setActiveRoomId(null);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[80vh] overflow-y-auto z-[70]" overlayClassName="z-[69]">
        <SheetHeader>
          <SheetTitle>{t.equipmentTruth.roomSweepTitle}</SheetTitle>
          <SheetDescription>{t.equipmentTruth.roomSweepDesc}</SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-1 pb-6">
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-4">{t.common.loading}</p>
          ) : !rooms?.length ? (
            <p className="text-sm text-muted-foreground py-4">{t.equipmentTruth.confirmInRoomNoRooms}</p>
          ) : (
            rooms.map((room) => {
              const pending = sweepMut.isPending && activeRoomId === room.id;
              return (
                <div
                  key={room.id}
                  className="flex items-center gap-2 rounded-xl border border-border/60 p-2"
                >
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={sweepMut.isPending}
                    onClick={() => {
                      setActiveRoomId(room.id);
                      sweepMut.mutate(room.id);
                    }}
                    className={cn(
                      "flex flex-1 items-center gap-3 min-h-[48px] px-2 text-left rounded-lg hover:bg-muted transition-colors",
                    )}
                    data-testid={`room-sweep-${room.id}`}
                  >
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      {pending ? (
                        <Loader2 className="w-4 h-4 animate-spin text-primary" />
                      ) : (
                        <DoorOpen className="w-4 h-4 text-primary" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{room.name}</p>
                      <p className="text-xs text-muted-foreground">{t.equipmentTruth.roomSweepAction}</p>
                    </div>
                  </Button>
                  <Link href={`/rooms/${room.id}`}>
                    <Button type="button" variant="ghost" size="sm" className="shrink-0 h-10">
                      <Radar className="w-4 h-4" />
                    </Button>
                  </Link>
                </div>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
