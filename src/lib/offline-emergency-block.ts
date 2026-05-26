// Phase 9 PR 9.5 — Offline emergency mutation blocking.
//
// Code Blue mutations (session start/end, log entries, presence heartbeats)
// must NEVER be queued for offline replay. Replaying clinical actions
// minutes or hours after the live emergency would violate clinical
// correctness. The doctrine (plan §3.8) requires:
//
//   - Loud, immediate failure on offline attempt (toast).
//   - Local-only sessionStorage telemetry buffer (≤ 200 FIFO, tab-scoped).
//   - Best-effort server counter increment via the existing realtime
//     telemetry endpoint — NEVER via a new deferred-telemetry endpoint and
//     never by posting the sessionStorage buffer contents.
//   - The sessionStorage buffer is never posted to the server, never
//     persisted to IndexedDB, never queued for replay-as-mutation.
//
// This module deliberately does NOT import from `@/lib/api`. The telemetry
// POST that pairs with `recordEmergencyBlockLocally` lives at the call
// site (inside `src/lib/api.ts.request()`), which keeps this module
// dependency-free and avoids a circular import.

import { safeStorageGetItem, safeStorageSetItem } from "@/lib/safe-browser";
import {
  EMERGENCY_OFFLINE_BLOCK_MUTATIONS,
  normalizeEmergencyPathname,
  type EmergencyEndpointClass,
} from "../../shared/emergency-surfaces.manifest";

export type { EmergencyEndpointClass };

const BUFFER_KEY = "vt_offline_emergency_buffer_v1";
const BUFFER_MAX = 200;

type LocalBufferEntry = {
  ts: number;
  endpointClass: EmergencyEndpointClass;
  reason: "offline";
};

/**
 * Classify an outgoing request as a Code Blue emergency mutation. Returns
 * the bounded enum endpoint class, or null for any non-emergency endpoint.
 *
 * Matching is intentionally narrow — only mutation endpoints listed in
 * `EMERGENCY_OFFLINE_BLOCK_MUTATIONS` (shared/emergency-surfaces.manifest.ts).
 * Read endpoints (GET /sessions/active, /history, /reconciliation) are NOT blocked.
 */
export function classifyEmergencyEndpoint(url: string, method: string): EmergencyEndpointClass | null {
  const upperMethod = method.toUpperCase();
  const pathname = normalizeEmergencyPathname(url);

  for (const entry of EMERGENCY_OFFLINE_BLOCK_MUTATIONS) {
    if (upperMethod === entry.method && entry.pathPattern.test(pathname)) {
      return entry.class;
    }
  }
  return null;
}

function readBuffer(): LocalBufferEntry[] {
  const raw = safeStorageGetItem(BUFFER_KEY, "session");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e): e is LocalBufferEntry => {
        if (!e || typeof e !== "object") return false;
        const obj = e as Record<string, unknown>;
        return (
          typeof obj.ts === "number" &&
          typeof obj.endpointClass === "string" &&
          ["start", "log", "end", "presence"].includes(obj.endpointClass) &&
          obj.reason === "offline"
        );
      })
      .slice(-BUFFER_MAX);
  } catch {
    return [];
  }
}

function writeBuffer(entries: LocalBufferEntry[]): void {
  const trimmed = entries.slice(-BUFFER_MAX);
  try {
    safeStorageSetItem(BUFFER_KEY, JSON.stringify(trimmed), "session");
  } catch {
    // Storage quota or private-browsing mode — best-effort only.
  }
}

/** Append an entry to the local FIFO buffer. Capped at BUFFER_MAX entries. */
export function recordEmergencyBlockLocally(endpointClass: EmergencyEndpointClass): void {
  const current = readBuffer();
  current.push({ ts: Date.now(), endpointClass, reason: "offline" });
  writeBuffer(current);
}

// Note: the telemetry post for the bounded enum
// `offlineEmergencyMutationBlocked` is emitted at the call site in
// `src/lib/api.ts` immediately after `recordEmergencyBlockLocally` to keep
// this module free of an `api` import (avoids a circular dependency). The
// doctrine still forbids posting the sessionStorage buffer contents — only
// the bounded enum endpoint class crosses the wire.

/**
 * Test-only — reads the in-tab block-history buffer. A future
 * incident-reconstruction UI may want to surface this; when that PR
 * lands, add a public alias next to this function and switch the test
 * suite to it. Keeping a public export today (with no production
 * consumer) is dead code, so we expose only the test alias for now.
 */
export function _readEmergencyBlockBufferForTests(): readonly LocalBufferEntry[] {
  return readBuffer();
}

/** Test-only — clear the sessionStorage buffer between cases. */
export function _clearEmergencyBlockBufferForTests(): void {
  try {
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(BUFFER_KEY);
    }
  } catch {
    // ignore
  }
}
