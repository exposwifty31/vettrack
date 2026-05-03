import type { Response } from "express";
import { incrementMetric } from "./metrics.js";

export type RealtimeEventType =
  | "TASK_CREATED"
  | "TASK_STARTED"
  | "TASK_COMPLETED"
  | "TASK_CANCELLED"
  | "TASK_APPROVED"
  | "TASK_UPDATED"
  | "AUTOMATION_TRIGGERED"
  | "NOTIFICATION_REQUESTED"
  | "NOTIFICATION_SENT"
  | "ER_INTAKE_CREATED"
  | "ER_INTAKE_UPDATED"
  | "QUEUE_SEVERITY_ESCALATED"
  | "ER_HANDOFF_CREATED"
  | "ER_HANDOFF_ACKNOWLEDGED"
  | "ER_HANDOFF_SLA_BREACHED"
  | "ER_HANDOFF_OVERRIDDEN"
  | "PATIENT_STATUS_UPDATED";

export type RealtimeEvent = {
  type: RealtimeEventType;
  payload: unknown;
  timestamp: string;
};

const clientsByClinic = new Map<string, Set<Response>>();
const heartbeats = new Map<Response, NodeJS.Timeout>();
// 150 concurrent SSE connections per clinic — accounts for service workers + tabs
const MAX_CLIENTS_PER_CLINIC = 150;

function safeWrite(res: Response, chunk: string): boolean {
  try {
    res.write(chunk);
    return true;
  } catch {
    return false;
  }
}

function connectionCount(): number {
  let total = 0;
  for (const set of clientsByClinic.values()) total += set.size;
  return total;
}

function setConnectionMetric(): void {
  incrementMetric("realtime_connections", connectionCount());
}

export function subscribe(clinicId: string, res: Response): void {
  try {
    const normalizedClinicId = clinicId.trim();
    if (!normalizedClinicId) return;
    const current = clientsByClinic.get(normalizedClinicId) ?? new Set<Response>();
    if (current.size >= MAX_CLIENTS_PER_CLINIC) {
      const oldest = current.values().next().value as Response | undefined;
      if (oldest) {
        try {
          oldest.write('event: CONNECTION_EVICTED\ndata: {"reason":"cap_exceeded"}\n\n');
        } catch {
          // Ignore write errors on stale connection.
        }
        unsubscribe(oldest);
        try {
          oldest.end();
        } catch {
          // Ignore close errors.
        }
        console.warn('[sse] client evicted', { clinicId: normalizedClinicId, remaining: current.size });
      }
    }
    current.add(res);
    clientsByClinic.set(normalizedClinicId, current);

    safeWrite(res, ": connected\n\n");
    const heartbeat = setInterval(() => {
      safeWrite(res, ": keep-alive\n\n");
    }, 20_000);
    heartbeats.set(res, heartbeat);
    setConnectionMetric();
  } catch {
    // Best-effort realtime channel only.
  }
}

export function unsubscribe(res: Response): void {
  try {
    for (const [clinicId, clients] of clientsByClinic.entries()) {
      if (!clients.delete(res)) continue;
      if (clients.size === 0) clientsByClinic.delete(clinicId);
      break;
    }
    const heartbeat = heartbeats.get(res);
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeats.delete(res);
    }
    setConnectionMetric();
  } catch {
    // Best-effort cleanup.
  }
}

/** Push lightweight SSE notifications to connected tabs (no outbox persistence). */
export function broadcast(
  clinicId: string,
  event: { type: RealtimeEventType; payload: unknown; timestamp?: string },
): void {
  const normalizedClinicId = clinicId.trim();
  if (!normalizedClinicId) return;
  const set = clientsByClinic.get(normalizedClinicId);
  if (!set || set.size === 0) return;
  const envelope = {
    type: event.type,
    payload: event.payload,
    timestamp: event.timestamp ?? new Date().toISOString(),
  };
  const chunk = `data: ${JSON.stringify(envelope)}\n\n`;
  for (const res of set) {
    safeWrite(res, chunk);
  }
}
