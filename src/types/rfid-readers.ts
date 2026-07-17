// Client-facing RFID reader registry types (Phase 7c). The row shape + status
// enum live in shared/ (server derives them); this re-exports for src/types consumers.
export type { RfidReaderRow, RfidReaderStatus } from "../../shared/rfid-readers.js";
// Managed reader entity (R-M1.1b): CRUD view with heartbeat-derived health.
export type { ManagedRfidReaderRow, ManagedReaderHealth } from "../../shared/rfid-readers.js";
