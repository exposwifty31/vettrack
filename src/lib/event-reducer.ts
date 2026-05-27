import type { QueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";

import { ER_MODE_QUERY_KEY, getErAssignees, getErBoard, getErEligibleHospitalizations, getErMode } from "@/lib/er-api";

import type {
  CopAlertEntry,
  PotentialOrphanUsePayload,
  ProbableOrphanUsagePayload,
  SuspectedOrphanStockPayload,
} from "@/types/cop-alerts";

import type { RealtimeEvent } from "@/types/realtime-events";
import { invalidateEquipmentCaches } from "@/lib/equipment-realtime";
import { getCurrentUserId } from "@/lib/auth-store";
import { toast } from "sonner";
import { t } from "@/lib/i18n";



/** ER Command Center — kept in sync with `src/pages/er-command-center.tsx`. */

export const ER_BOARD_QUERY_KEY = ["er", "board"] as const;

export const ER_ASSIGNEES_QUERY_KEY = ["er", "assignees"] as const;

export const ER_ELIGIBLE_HOSP_QUERY_KEY = ["er", "eligible-hospitalizations"] as const;



/** Ward display snapshot — `src/hooks/useDisplaySnapshot.ts`. */

export const DISPLAY_SNAPSHOT_QUERY_KEY = ["/api/display/snapshot"] as const;



/** Smart Cop — orphan drug / order mismatch alerts (see `POTENTIAL_ORPHAN_USE` SSE). */

export const ORPHAN_DRUG_ALERTS_QUERY_KEY = ["cop", "orphan-drug-alerts"] as const;



/**

 * Applies one realtime event by fetching authoritative server slices and writing them into the

 * React Query cache (no blanket invalidation flicker).

 */

export async function applyEvent(client: QueryClient, event: RealtimeEvent): Promise<void> {

  switch (event.type) {

    case "RESET_STATE":

      await resetRealtimeCaches(client);

      return;



    case "ER_MODE_CHANGED": {

      const mode = await getErMode();

      client.setQueryData(ER_MODE_QUERY_KEY, mode);

      return;

    }



    case "ER_INTAKE_CREATED":

    case "ER_INTAKE_UPDATED":

    case "QUEUE_SEVERITY_ESCALATED":

    case "ER_HANDOFF_CREATED":

    case "ER_HANDOFF_ACKNOWLEDGED":

    case "ER_HANDOFF_SLA_BREACHED": {

      const [board, assignees] = await Promise.all([

        getErBoard(),

        getErAssignees(),

      ]);

      client.setQueryData(ER_BOARD_QUERY_KEY, board);

      client.setQueryData(ER_ASSIGNEES_QUERY_KEY, assignees);

      const eligible = await getErEligibleHospitalizations().catch(() => null);

      if (eligible) {

        client.setQueryData(ER_ELIGIBLE_HOSP_QUERY_KEY, eligible);

      }

      return;

    }



    case "PATIENT_STATUS_UPDATED":
    case "CODE_BLUE_STATUS_CHANGED": {

      const snapshot = await api.display.snapshot();

      client.setQueryData(DISPLAY_SNAPSHOT_QUERY_KEY, snapshot);

      return;

    }



    // Phase 9 PR 9.3 — task lifecycle events also alter what the Department
    // Display renders (overdue meds, upcoming tasks). Invalidate the
    // snapshot so the next render reads from the server. We invalidate
    // rather than refetch-merge because the snapshot endpoint is server-side
    // aggregated and cheap to re-fetch.
    case "TASK_CREATED":

    case "TASK_STARTED":

    case "TASK_COMPLETED":

    case "TASK_APPROVED":

    case "TASK_UPDATED":

    case "TASK_CANCELLED": {

      await client.invalidateQueries({ queryKey: DISPLAY_SNAPSHOT_QUERY_KEY });

      return;

    }



    case "INVENTORY_ALERT": {

      await client.invalidateQueries({ queryKey: ["/api/containers"] });

      return;

    }



    case "POTENTIAL_ORPHAN_USE": {

      const payload = event.payload as PotentialOrphanUsePayload;

      const oid =

        typeof event.id === "number"

          ? event.id

          : typeof event.outboxId === "number"

            ? event.outboxId

            : Math.floor(Date.now());

      client.setQueryData(ORPHAN_DRUG_ALERTS_QUERY_KEY, (prev: CopAlertEntry[] | undefined) => {

        const row: CopAlertEntry = {

          ...payload,

          variant: "order_mismatch",

          dismissable: true,

          eventId: oid,

          receivedAt: event.timestamp,

        };

        const base = [...(prev ?? [])];

        const deduped = base.filter((x) => x.eventId !== row.eventId);

        deduped.unshift(row);

        return deduped.slice(0, 40);

      });

      await client.invalidateQueries({ queryKey: ["/api/tasks/medication-active"] });

      return;

    }

    case "SUSPECTED_ORPHAN_STOCK": {

      const payload = event.payload as SuspectedOrphanStockPayload;

      const oid =

        typeof event.id === "number"

          ? event.id

          : typeof event.outboxId === "number"

            ? event.outboxId

            : Math.floor(Date.now());

      client.setQueryData(ORPHAN_DRUG_ALERTS_QUERY_KEY, (prev: CopAlertEntry[] | undefined) => {

        const row: CopAlertEntry = {

          ...payload,

          variant: "charged_no_admin",

          dismissable: false,

          eventId: oid,

          receivedAt: event.timestamp,

        };

        const base = [...(prev ?? [])];

        const deduped = base.filter((x) => x.eventId !== row.eventId);

        deduped.unshift(row);

        return deduped.slice(0, 40);

      });

      return;

    }

    case "PROBABLE_ORPHAN_USAGE": {

      const payload = event.payload as ProbableOrphanUsagePayload;

      const oid =

        typeof event.id === "number"

          ? event.id

          : typeof event.outboxId === "number"

            ? event.outboxId

            : Math.floor(Date.now());

      client.setQueryData(ORPHAN_DRUG_ALERTS_QUERY_KEY, (prev: CopAlertEntry[] | undefined) => {

        const row: CopAlertEntry = {

          ...payload,

          variant: "admin_no_dispense",

          dismissable: false,

          eventId: oid,

          receivedAt: event.timestamp,

        };

        const base = [...(prev ?? [])];

        const deduped = base.filter((x) => x.eventId !== row.eventId);

        deduped.unshift(row);

        return deduped.slice(0, 40);

      });

      await client.invalidateQueries({ queryKey: ["/api/tasks/medication-active"] });

      return;

    }

    case "SHADOW_ORPHAN_ALERT_RESOLVED": {

      const payload = event.payload as {

        billingLedgerId?: string;

        inventoryLogId?: string;

        taskId?: string;

      };

      client.setQueryData(ORPHAN_DRUG_ALERTS_QUERY_KEY, (prev: CopAlertEntry[] | undefined) => {

        const list = prev ?? [];

        return list.filter((x) => {

          if (payload.billingLedgerId && x.variant === "charged_no_admin" && x.billingLedgerId === payload.billingLedgerId) {

            return false;

          }

          if (payload.inventoryLogId && x.variant === "charged_no_admin" && x.inventoryLogId === payload.inventoryLogId) {

            return false;

          }

          if (payload.taskId && x.variant === "admin_no_dispense" && x.taskId === payload.taskId) {

            return false;

          }

          return true;

        });

      });

      return;

    }



    case "EQUIPMENT_CUSTODY_STATE_CHANGED":
    case "EQUIPMENT_USAGE_STATE_CHANGED":
    case "EQUIPMENT_READINESS_STATE_CHANGED":
    case "EQUIPMENT_DOCK_RETURN":
    case "EQUIPMENT_STAGED":
    case "EQUIPMENT_STAGE_CANCELLED":
    case "EQUIPMENT_EMERGENCY_CHECKOUT":
    case "EQUIPMENT_WAITLIST_JOINED":
    case "EQUIPMENT_WAITLIST_LEFT":
    case "EQUIPMENT_WAITLIST_EXPIRED": {
      const equipmentId =
        typeof event.payload === "object" &&
        event.payload !== null &&
        "equipmentId" in event.payload &&
        typeof (event.payload as { equipmentId: unknown }).equipmentId === "string"
          ? (event.payload as { equipmentId: string }).equipmentId
          : undefined;
      await invalidateEquipmentCaches(client, equipmentId);
      return;
    }

    case "EQUIPMENT_WAITLIST_AVAILABLE": {
      const payload = event.payload as { equipmentId?: string };
      await invalidateEquipmentCaches(client, payload.equipmentId);
      return;
    }

    case "EQUIPMENT_WAITLIST_PROMOTED": {
      const payload = event.payload as {
        equipmentId?: string;
        userId?: string;
      };
      const equipmentId = payload.equipmentId;
      await invalidateEquipmentCaches(client, equipmentId);
      const currentUserId = getCurrentUserId();
      if (equipmentId && payload.userId && currentUserId && payload.userId === currentUserId) {
        toast.success(t.equipmentWaitlist.promotedToast, {
          description: t.equipmentWaitlist.promotedToastDescription,
          action: {
            label: t.equipmentWaitlist.viewDevice,
            onClick: () => {
              window.location.href = `/equipment/${equipmentId}`;
            },
          },
        });
      }
      return;
    }

    default:

      return;

  }

}



/** Invalidates sequence state and refetches ward + ER caches (gap detection — keeps orphan Cop alerts). */

export async function forceResyncWardErCaches(client: QueryClient): Promise<void> {

  await Promise.all([

    client.refetchQueries({ queryKey: ER_BOARD_QUERY_KEY }),

    client.refetchQueries({ queryKey: ER_ASSIGNEES_QUERY_KEY }),

    client.refetchQueries({ queryKey: ER_ELIGIBLE_HOSP_QUERY_KEY }),

    client.refetchQueries({ queryKey: DISPLAY_SNAPSHOT_QUERY_KEY }),

    client.invalidateQueries({ queryKey: ["/api/containers"] }),

  ]);

}



/** Full SSE reset: ward caches + clear ephemeral Cop alert queue. */

export async function resetRealtimeCaches(client: QueryClient): Promise<void> {

  await forceResyncWardErCaches(client);

  await client.removeQueries({ queryKey: ORPHAN_DRUG_ALERTS_QUERY_KEY });

}


