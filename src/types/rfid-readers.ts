// Client-facing RFID reader registry types (Phase 7c). The row shape + status
// enum live in shared/ (server derives them); this re-exports for src/types consumers.
export type { RfidReaderRow, RfidReaderStatus } from "../../shared/rfid-readers.js";
// Managed reader entity (R-M1.1b): CRUD view with heartbeat-derived health.
export type { ManagedRfidReaderRow, ManagedReaderHealth } from "../../shared/rfid-readers.js";

/** Rotation lifecycle status returned by the provisioning endpoint (R-M1.1c). */
export type RfidRotationStatus = "grace" | "completed" | "rolled_back";

/**
 * Client view of a secret-rotation envelope (R-M1.1e admin console). `secret` is present
 * exactly once — in the first successful provision response — and is never re-delivered.
 */
export type RfidRotationEnvelope = {
  rotationId: string;
  status: RfidRotationStatus;
  /** Delivered exactly once (first success). Absent on every replay/rollback envelope. */
  secret?: string;
  secretDelivered: boolean;
  graceExpiresAt: string;
  rollbackAvailable: boolean;
  snapshotReaderIds: string[];
};
