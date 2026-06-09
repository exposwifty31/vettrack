import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { DoorOpen, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface EquipmentConfirmInRoomSheetProps {
  equipmentId: string;
  equipmentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmed?: () => void;
}

export function EquipmentConfirmInRoomSheet({
  equipmentId,
  equipmentName,
  open,
  onOpenChange,
  onConfirmed,
}: EquipmentConfirmInRoomSheetProps) {
  const queryClient = useQueryClient();
  const { userId } = useAuth();
  const [pickedRoomId, setPickedRoomId] = useState<string | null>(null);

  const { data: rooms, isLoading } = useQuery({
    queryKey: ["/api/rooms"],
    queryFn: api.rooms.list,
    enabled: !!userId && open,
    staleTime: 60_000,
  });

  const confirmMut = useMutation({
    mutationFn: (roomId: string) => api.equipment.confirmInRoom(equipmentId, { roomId }),
    onSuccess: (result) => {
      toast.success(t.equipmentTruth.confirmInRoomDone(result.roomName));
      queryClient.invalidateQueries({ queryKey: [`/api/equipment/${equipmentId}`] });
      queryClient.invalidateQueries({ queryKey: ["equipment-truth", equipmentId] });
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rooms"] });
      setPickedRoomId(null);
      onOpenChange(false);
      onConfirmed?.();
    },
    onError: () => toast.error(t.equipmentTruth.confirmInRoomFailed),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[80vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t.equipmentTruth.confirmInRoomTitle}</SheetTitle>
          <SheetDescription>{t.equipmentTruth.confirmInRoomDesc(equipmentName)}</SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-1 pb-6">
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-4">{t.common.loading}</p>
          ) : !rooms?.length ? (
            <p className="text-sm text-muted-foreground py-4">{t.equipmentTruth.confirmInRoomNoRooms}</p>
          ) : (
            rooms.map((room) => {
              const selected = pickedRoomId === room.id;
              const pending = confirmMut.isPending && selected;
              return (
                <Button
                  key={room.id}
                  type="button"
                  variant="ghost"
                  disabled={confirmMut.isPending}
                  onClick={() => {
                    setPickedRoomId(room.id);
                    confirmMut.mutate(room.id);
                  }}
                  className={cn(
                    "flex items-center justify-between gap-3 w-full px-3 py-3 rounded-xl min-h-[52px] text-left transition-colors",
                    selected ? "bg-primary/10 text-primary" : "hover:bg-muted",
                  )}
                  data-testid={`confirm-in-room-${room.id}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <DoorOpen className="w-4 h-4" />
                    </div>
                    <span className="font-medium truncate">{room.name}</span>
                  </div>
                  {pending ? (
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  ) : selected ? (
                    <Check className="w-4 h-4 shrink-0" />
                  ) : null}
                </Button>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
