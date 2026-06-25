import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Equipment, ScanLog } from "@/types";

export interface ScanResult {
  equipment: Equipment;
  scanLog: ScanLog;
  undoToken?: string;
  pendingSyncId?: number;
}

export function useScanAccountability() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (equipmentId: string): Promise<ScanResult> => {
      return api.equipment.scan(equipmentId, { status: "ok" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
    },
  });

  return {
    scan: mutation.mutate,
    scanAsync: mutation.mutateAsync,
    data: mutation.data,
    isLoading: mutation.isPending,
    isError: mutation.isError,
    reset: mutation.reset,
  };
}
