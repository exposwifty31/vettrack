/**
 * VetTrack 2.0, Task 1.1 §1.5 — a tiny module-level registry holding the
 * live collab Socket.io server instance, so non-socket code (REST route
 * handlers, BullMQ workers) can emit an ADVISORY nudge without importing
 * `server.ts`'s connection-handling internals. `server.ts` is the ONLY
 * writer (set on successful init, cleared on teardown/disable); every other
 * caller only reads. Never throws; a reader before init (or after a
 * disabled/closed channel) simply sees `undefined` — callers must treat
 * that as "collab unavailable, degrade" (see `proposal-queue-nudge.ts`).
 */
import type { Server } from "socket.io";

let currentIo: Server | undefined;

/** Test/production seam — `server.ts` calls this on init success/teardown. */
export function setCollabIo(io: Server | undefined): void {
  currentIo = io;
}

/** Never throws. Returns `undefined` when the collab channel is disabled or not yet initialized. */
export function getCollabIo(): Server | undefined {
  return currentIo;
}
