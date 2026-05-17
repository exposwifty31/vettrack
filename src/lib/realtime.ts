import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { applyEvent, DISPLAY_SNAPSHOT_QUERY_KEY, forceResyncWardErCaches, resetRealtimeCaches } from "@/lib/event-reducer";
import type { RealtimeEvent } from "@/types/realtime-events";
import { SUPPORTED_REALTIME_EVENT_SCHEMA_VERSION } from "../../shared/realtime-schema-version";

export type { RealtimeEventType, RealtimeEvent } from "@/types/realtime-events";

const LAST_OUTBOX_STORAGE_KEY = "vt_realtime_last_outbox_id";
const BC_CHANNEL = "vt_realtime_outbox_cursor";

let source: EventSource | null = null;
let broadcastChannel: BroadcastChannel | null = null;

/** Shared SSE connection: multiple {@link EventIngestor}s (ER + ward display, etc.) receive the same stream. */
const ingestors = new Set<EventIngestor>();
const legacyHandlers = new Set<(event: RealtimeEvent) => void>();
let streamSubscriptions = 0;

// Phase 9 PR 9.4 — keepalive subscribers.
//
// The server emits a structured `KEEPALIVE` event every ~10 s carrying
// `{ activeCodeBlueSessionId, stormHint }`. Keepalives are intercepted here
// and routed to keepalive subscribers ONLY — they never reach the
// EventIngestor or legacy handlers, so they cannot accidentally invalidate
// query caches as if they were outbox events.
export type RealtimeKeepalivePayload = {
  activeCodeBlueSessionId: string | null;
  stormHint: "none" | "elevated";
};
const keepaliveSubscribers = new Set<(payload: RealtimeKeepalivePayload) => void>();

export function subscribeKeepalive(callback: (payload: RealtimeKeepalivePayload) => void): () => void {
  keepaliveSubscribers.add(callback);
  return () => {
    keepaliveSubscribers.delete(callback);
  };
}

function isKeepaliveEnvelope(raw: unknown): raw is { type: "KEEPALIVE"; payload: RealtimeKeepalivePayload } {
  if (!raw || typeof raw !== "object") return false;
  const obj = raw as { type?: unknown; payload?: unknown };
  if (obj.type !== "KEEPALIVE") return false;
  const p = obj.payload as { activeCodeBlueSessionId?: unknown; stormHint?: unknown } | undefined;
  if (!p || typeof p !== "object") return false;
  const idOk = p.activeCodeBlueSessionId === null || typeof p.activeCodeBlueSessionId === "string";
  const hintOk = p.stormHint === "none" || p.stormHint === "elevated";
  return idOk && hintOk;
}

// Phase 9 PR 9.4 — propagation latency measurement.
//
// We tag select Code Blue event types with their server-side outbox creation
// timestamp inside `payload.occurredAt` (already provided by the SSE
// envelope). When applied to the cache, the client computes `end_ts -
// start_ts`, classifies into the fixed enum buckets, and best-effort sends it
// to /api/realtime/telemetry. Raw milliseconds are NEVER stored or labelled
// — only the bucket. Client clocks are explicitly non-authoritative.
const CODE_BLUE_PROPAGATION_EVENT_TYPES = new Set<string>([
  // CB-related domain event names that travel through the outbox today. The
  // event-reducer's TASK_* invalidation already covers CB log entries via
  // their task-shaped outbox events. PATIENT_STATUS_UPDATED can carry CB
  // start/end. The set below is intentionally permissive — we measure
  // propagation for any event that drives a Code Blue UI update.
  "PATIENT_STATUS_UPDATED",
]);

function classifyPropagationMs(ms: number): "lt_1s" | "lt_3s" | "lt_15s" | "gte_15s" {
  if (ms < 1_000) return "lt_1s";
  if (ms < 3_000) return "lt_3s";
  if (ms < 15_000) return "lt_15s";
  return "gte_15s";
}

function maybeReportPropagation(ev: RealtimeEvent): void {
  try {
    if (!CODE_BLUE_PROPAGATION_EVENT_TYPES.has(ev.type)) return;
    if (typeof ev.timestamp !== "string") return;
    const startMs = Date.parse(ev.timestamp);
    if (!Number.isFinite(startMs)) return;
    const deltaMs = Date.now() - startMs;
    if (deltaMs < 0 || deltaMs > 5 * 60_000) return; // sanity: ignore obvious clock skew
    const bucket = classifyPropagationMs(deltaMs);
    void api.realtime.telemetry({ codeBluePropagationBucket: bucket }).catch(() => {});
  } catch {
    // never throw from telemetry path
  }
}

function getBroadcastChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (!broadcastChannel) {
    broadcastChannel = new BroadcastChannel(BC_CHANNEL);
  }
  return broadcastChannel;
}

// Phase 9 PR 9.6 — BroadcastChannel envelope + gossip kinds.
//
// All Phase 9 BroadcastChannel publishes wrap their payload in a uniform
// envelope so receivers can locally discard stale cursors, repeated
// mismatched build tags, and rapid duplicate envelopes from the same sender.
//
// Cross-tab ordering is rooted in the monotonic outbox `cursor` — never in
// `ts` (client wall-clock skew differs between tabs). `ts` and `senderNonce`
// are advisory only (plan §3.7).
//
// Legacy compatibility: un-enveloped `{ kind: "cursor", id }` messages from
// older clients are accepted for one release cycle.
type BcEnvelopeBase = {
  kind: "cursor" | "build_tag" | "code_blue_seen";
  cursor: number;
  buildTag: string;
  ts: number;
  senderNonce: string;
};

type BcCursorEnvelope = BcEnvelopeBase & {
  kind: "cursor";
  // The authoritative cursor is the envelope-level `cursor` field. No
  // additional payload is required for cursor envelopes; the receiver in
  // `onBroadcast` only reads `data.cursor`. Keeping `payload` empty
  // mirrors the build_tag envelope shape and avoids transmitting dead
  // data on every cursor publish.
  payload: Record<string, never>;
};

type BcBuildTagEnvelope = BcEnvelopeBase & {
  kind: "build_tag";
  payload: Record<string, never>;
};

type BcCodeBlueSeenEnvelope = BcEnvelopeBase & {
  kind: "code_blue_seen";
  payload: { sessionId: string | null };
};

type BcEnvelope = BcCursorEnvelope | BcBuildTagEnvelope | BcCodeBlueSeenEnvelope;

const SENDER_NONCE: string = (() => {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      const buf = new Uint8Array(6);
      crypto.getRandomValues(buf);
      return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
    }
  } catch {
    // fall through
  }
  return Math.random().toString(36).slice(2, 14);
})();

function clientBuildTag(): string {
  try {
    return typeof __VT_BUILD_TAG__ !== "undefined" ? __VT_BUILD_TAG__ : "unknown";
  } catch {
    return "unknown";
  }
}

function publishEnvelope(envelope: BcEnvelope): void {
  try {
    getBroadcastChannel()?.postMessage(envelope);
  } catch {
    // BroadcastChannel is best-effort.
  }
}

function publishCursor(id: number): void {
  publishEnvelope({
    kind: "cursor",
    payload: {},
    cursor: id,
    buildTag: clientBuildTag(),
    ts: Date.now(),
    senderNonce: SENDER_NONCE,
  });
}

export function publishBuildTagGossip(): void {
  publishEnvelope({
    kind: "build_tag",
    payload: {},
    cursor: readStoredLastOutboxId() ?? 0,
    buildTag: clientBuildTag(),
    ts: Date.now(),
    senderNonce: SENDER_NONCE,
  });
}

export function publishCodeBlueSeenGossip(sessionId: string | null): void {
  publishEnvelope({
    kind: "code_blue_seen",
    payload: { sessionId },
    cursor: readStoredLastOutboxId() ?? 0,
    buildTag: clientBuildTag(),
    ts: Date.now(),
    senderNonce: SENDER_NONCE,
  });
}

// Build-tag mismatch banner is one-shot per loaded build. Repeated gossip
// from the same divergent `buildTag` (or further gossip after the banner has
// already fired) is silently ignored to prevent toast spam.
const seenMismatchedBuildTags = new Set<string>();
let buildTagBannerFired = false;

function noteBuildTagMismatchOnce(remoteBuildTag: string): void {
  const local = clientBuildTag();
  if (!remoteBuildTag || remoteBuildTag === local) return;
  if (seenMismatchedBuildTags.has(remoteBuildTag)) return;
  seenMismatchedBuildTags.add(remoteBuildTag);
  if (buildTagBannerFired) return;
  buildTagBannerFired = true;
  // Phase 9 PR 9.7 — operational telemetry. Bounded boolean payload; the
  // remote buildTag is not transmitted (it would create unbounded label
  // cardinality on the server).
  //
  // We intentionally do NOT fire `swUpdateConflict` here: that counter is
  // reserved for the genuine SW update conflict path (SW posts SW_UPDATED
  // with a different buildTag than the loaded bundle). A peer-tab divergence
  // observed via BroadcastChannel is a separate signal — `splitVersionClientDetected`
  // covers it without inflating the SW-conflict counter and muddying ops
  // dashboards.
  void api.realtime
    .telemetry({ splitVersionClientDetected: true })
    .catch(() => {});
  try {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("sw-update-available", {
          detail: { worker: null, buildTag: remoteBuildTag },
        }),
      );
    }
  } catch {
    // Banner is best-effort.
  }
}

function isLegacyCursorMessage(raw: unknown): raw is { kind: "cursor"; id: number } {
  if (!raw || typeof raw !== "object") return false;
  const obj = raw as { kind?: unknown; id?: unknown; cursor?: unknown };
  if (obj.kind !== "cursor") return false;
  if (typeof obj.id !== "number" || !Number.isFinite(obj.id)) return false;
  // Envelope (PR 9.6+) also has `cursor`; legacy does not.
  return obj.cursor === undefined;
}

function isEnvelope(raw: unknown): raw is BcEnvelope {
  if (!raw || typeof raw !== "object") return false;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.kind !== "string") return false;
  if (!["cursor", "build_tag", "code_blue_seen"].includes(obj.kind as string)) return false;
  if (typeof obj.cursor !== "number" || !Number.isFinite(obj.cursor)) return false;
  if (typeof obj.buildTag !== "string") return false;
  if (typeof obj.ts !== "number" || !Number.isFinite(obj.ts)) return false;
  if (typeof obj.senderNonce !== "string") return false;
  if (!obj.payload || typeof obj.payload !== "object") return false;
  return true;
}

function readStoredLastOutboxId(): number | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(LAST_OUTBOX_STORAGE_KEY);
    if (raw == null || raw === "") return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

function writeStoredLastOutboxId(id: number): void {
  try {
    localStorage.setItem(LAST_OUTBOX_STORAGE_KEY, String(id));
    publishCursor(id);
  } catch {
    // ignore quota / private mode
  }
}

function clearStoredLastOutboxId(): void {
  try {
    localStorage.removeItem(LAST_OUTBOX_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function reportRealtimeTelemetry(body: { duplicateDrop?: boolean; gapResync?: boolean }): void {
  void api.realtime.telemetry(body).catch(() => {});
}

function resolveOutboxId(ev: RealtimeEvent): number | undefined {
  if (typeof ev.id === "number" && Number.isFinite(ev.id)) return ev.id;
  if (typeof ev.outboxId === "number" && Number.isFinite(ev.outboxId)) return ev.outboxId;
  return undefined;
}

function resolveEventVersion(ev: RealtimeEvent): number {
  if (typeof ev.eventVersion === "number" && Number.isFinite(ev.eventVersion)) {
    return ev.eventVersion;
  }
  return 1;
}

/** Highest `vt_event_outbox.id` in an HTTP replay batch (SSE uses separate path). */
function maxOutboxIdFromReplayBatch(events: readonly RealtimeEvent[]): number | null {
  let max: number | undefined;
  for (const ev of events) {
    const oid = resolveOutboxId(ev);
    if (oid !== undefined && (max === undefined || oid > max)) max = oid;
  }
  return max ?? null;
}

/** Maps `GET /api/realtime/replay` rows to the same shape as SSE payloads for {@link applyReplayBatch}. */
export function mapReplayApiRowToRealtimeEvent(row: {
  id: number;
  type: string;
  payload: unknown;
  timestamp: string;
  outboxId: number;
  eventVersion: number;
}): RealtimeEvent {
  const oid = Number(row.outboxId ?? row.id);
  return {
    type: row.type as RealtimeEvent["type"],
    payload: row.payload,
    timestamp: row.timestamp,
    id: oid,
    outboxId: oid,
    eventVersion: row.eventVersion,
  };
}

/**
 * Ordering + idempotency for outbox-backed SSE. Broadcast-only events (no `id`) skip sequence checks.
 */
export class EventIngestor {
  private lastAppliedEventId: number | null;

  /**
   * While HTTP replay is applied, live SSE may still deliver the same ids; drop those until replay
   * finishes (see {@link applyReplayBatch}). Cleared when replay completes.
   */
  private replaySuppressionMaxId: number | null = null;

  private gapRecoveryInFlight: Promise<void> | null = null;

  private peerRecoveryInFlight: Promise<void> | null = null;

  private readonly boundStorage: (e: StorageEvent) => void;

  private readonly boundBc: (ev: MessageEvent) => void;

  constructor(
    private readonly queryClient: QueryClient,
    seedLastId: number | null = readStoredLastOutboxId(),
  ) {
    this.lastAppliedEventId = seedLastId;
    this.boundStorage = (e: StorageEvent) => this.onPeerStorage(e);
    this.boundBc = (ev: MessageEvent) => this.onBroadcast(ev);
    if (typeof window !== "undefined") {
      window.addEventListener("storage", this.boundStorage);
      getBroadcastChannel()?.addEventListener("message", this.boundBc);
    }
  }

  dispose(): void {
    try {
      window.removeEventListener("storage", this.boundStorage);
      getBroadcastChannel()?.removeEventListener("message", this.boundBc);
    } catch {
      // ignore
    }
  }

  getLastAppliedEventId(): number | null {
    return this.lastAppliedEventId;
  }

  private onPeerStorage(ev: StorageEvent): void {
    if (ev.key !== LAST_OUTBOX_STORAGE_KEY || ev.newValue == null) return;
    const n = Number.parseInt(ev.newValue, 10);
    if (!Number.isFinite(n)) return;
    void this.handlePeerAhead(n);
  }

  // Phase 9 PR 9.6 — per-instance dedupe of rapid duplicate envelopes from
  // the same sender. The doctrine forbids using `ts` for cross-tab ordering;
  // we only use it (with the sender's nonce) to drop obvious self-emitted
  // duplicates within a few-millisecond window. Cross-tab ordering for
  // cursors remains rooted in the monotonic outbox id.
  private lastEnvelopeFromSender = new Map<string, { kind: string; cursor: number; ts: number }>();
  private static readonly RAPID_DUPLICATE_WINDOW_MS = 100;

  private isRapidDuplicate(envelope: BcEnvelope): boolean {
    const last = this.lastEnvelopeFromSender.get(envelope.senderNonce);
    if (!last) return false;
    if (last.kind !== envelope.kind) return false;
    if (last.cursor !== envelope.cursor) return false;
    return Math.abs(envelope.ts - last.ts) <= EventIngestor.RAPID_DUPLICATE_WINDOW_MS;
  }

  private recordEnvelopeFromSender(envelope: BcEnvelope): void {
    this.lastEnvelopeFromSender.set(envelope.senderNonce, {
      kind: envelope.kind,
      cursor: envelope.cursor,
      ts: envelope.ts,
    });
    // Bound the map size — keep at most 64 sender entries. Tabs come and go,
    // and we never need history beyond a few recent senders.
    if (this.lastEnvelopeFromSender.size > 64) {
      const firstKey = this.lastEnvelopeFromSender.keys().next().value;
      if (firstKey !== undefined) this.lastEnvelopeFromSender.delete(firstKey);
    }
  }

  private onBroadcast(ev: MessageEvent): void {
    const data = ev.data as unknown;

    // Legacy un-enveloped cursor message — accepted for one release cycle so
    // tabs on the older client don't fall out of cursor convergence with new
    // tabs in the same browser. This branch will be removed in a future PR.
    if (isLegacyCursorMessage(data)) {
      void this.handlePeerAhead(data.id);
      return;
    }

    if (!isEnvelope(data)) return;

    // Reject rapid duplicates from the same sender (advisory dedupe — never
    // used as ordering for valid peer-ahead cursor messages from different
    // senders).
    if (this.isRapidDuplicate(data)) return;
    this.recordEnvelopeFromSender(data);

    // Build-tag mismatch surfaces the existing update banner once. Repeated
    // mismatched gossip from the same buildTag is ignored.
    noteBuildTagMismatchOnce(data.buildTag);

    if (data.kind === "cursor") {
      void this.handlePeerAhead(data.cursor);
      return;
    }

    if (data.kind === "code_blue_seen") {
      const payload = data.payload as { sessionId?: unknown };
      const peerSessionId = typeof payload.sessionId === "string" || payload.sessionId === null
        ? (payload.sessionId as string | null)
        : null;
      // If a peer tab reports a different active Code Blue session than the
      // server-driven snapshot indicates, force a baseline refresh so all
      // tabs converge. The server snapshot remains authoritative; we never
      // decide locally that a session has ended.
      void this.handleCodeBlueSeenGossip(peerSessionId);
      return;
    }

    // kind === "build_tag" — no further action beyond the banner above.
  }

  private async handleCodeBlueSeenGossip(peerSessionId: string | null): Promise<void> {
    // Gate the full-baseline refresh on actual disagreement. Display tabs
    // publish this gossip on every `localCbId` change, including transitions
    // already delivered through SSE — without a peer-vs-local compare,
    // every CB state change caused O(N) redundant refetches across N open
    // kiosk tabs.
    //
    // We read the local active session id from the snapshot in React Query
    // cache. If the peer's claim matches what we already see locally, this
    // gossip is a no-op. Only on disagreement do we re-establish baseline —
    // and even then the server (snapshot endpoint) remains authoritative;
    // we are not letting a stale tab dictate state, only forcing a server
    // round-trip to converge.
    //
    // CRITICAL: non-display tabs (e.g. ER Command Center) also instantiate
    // `EventIngestor` and receive this gossip, but they never populate the
    // display snapshot in React Query. If we treated `getQueryData() ===
    // undefined` as `localSessionId = null`, those tabs would see a
    // permanent mismatch every time a display tab gossips a non-null
    // session id during an active Code Blue, triggering
    // `establishBaselineAfterFullRefresh` on every gossip. The
    // discriminated union below makes the receiver abstain when the local
    // tab has no cached opinion to compare against.
    const local = this.readLocalActiveCodeBlueSessionId();
    if (!local.known) {
      // This tab does not render the display snapshot. We have no local
      // opinion on the active Code Blue session id — the display tab(s)
      // that DO render the snapshot will react if their view disagrees
      // with the peer's. Abstain.
      return;
    }
    if ((local.sessionId ?? null) === (peerSessionId ?? null)) {
      return;
    }
    if (this.peerRecoveryInFlight) {
      await this.peerRecoveryInFlight;
      // Phase 9 pre-merge kill pass — re-check after the awaited
      // recovery. The cursor-triggered recovery that we just awaited
      // refetched the display snapshot via `forceResyncWardErCaches`.
      // If local now agrees with the peer, the gossip is moot. If it
      // still disagrees, fall through to start a fresh CB-specific
      // recovery — otherwise the disagreement could persist silently
      // until the next gossip / keepalive ~10 s later.
      const updated = this.readLocalActiveCodeBlueSessionId();
      if (!updated.known) return;
      if ((updated.sessionId ?? null) === (peerSessionId ?? null)) return;
      // still mismatched — fall through to recovery
    }
    this.peerRecoveryInFlight = (async () => {
      await this.establishBaselineAfterFullRefresh();
    })().finally(() => {
      this.peerRecoveryInFlight = null;
    });
    await this.peerRecoveryInFlight;
  }

  /**
   * Reads the local active Code Blue session id from the display snapshot
   * cached in React Query. Returns a discriminated union:
   *
   *   { known: false } — this tab has never fetched the display snapshot
   *     (e.g. ER Command Center, appointments, home). It has no local
   *     opinion; the caller must NOT compare against this as if it were a
   *     "null session id" claim.
   *
   *   { known: true; sessionId: string | null } — this tab has fetched
   *     the snapshot at least once. `sessionId` is either a real session
   *     id or null (server says no active Code Blue).
   *
   * Using a discriminated union prevents a class of false-positive
   * mismatches where a non-display tab would otherwise see every
   * non-null peer gossip as a disagreement and trigger redundant
   * baseline refreshes.
   */
  private readLocalActiveCodeBlueSessionId():
    | { known: false }
    | { known: true; sessionId: string | null } {
    try {
      const snapshot = this.queryClient.getQueryData<{
        codeBlueSession?: { id?: unknown } | null;
      }>(DISPLAY_SNAPSHOT_QUERY_KEY);
      if (snapshot === undefined) return { known: false };
      const id = snapshot.codeBlueSession?.id;
      return {
        known: true,
        sessionId: typeof id === "string" && id.length > 0 ? id : null,
      };
    } catch {
      return { known: false };
    }
  }

  /** Another tab advanced the cursor — catch up without applying skipped ids locally. */
  private async handlePeerAhead(peerCursor: number): Promise<void> {
    if (this.lastAppliedEventId !== null && peerCursor <= this.lastAppliedEventId) return;
    if (this.peerRecoveryInFlight) {
      await this.peerRecoveryInFlight;
      return;
    }

    this.peerRecoveryInFlight = (async () => {
      await this.establishBaselineAfterFullRefresh();
    })().finally(() => {
      this.peerRecoveryInFlight = null;
    });

    await this.peerRecoveryInFlight;
  }

  private async establishBaselineAfterFullRefresh(): Promise<void> {
    await forceResyncWardErCaches(this.queryClient);
    try {
      const head = await api.realtime.outboxHead();
      const id = Number(head.maxPublishedId);
      if (!Number.isFinite(id) || id < 0) return;
      this.lastAppliedEventId = id;
      writeStoredLastOutboxId(id);
    } catch {
      // Keep prior cursor if head fetch fails.
    }
  }

  /** Gap detection + idempotent apply; coordinates cache updates via {@link applyEvent}. */
  ingest(ev: RealtimeEvent): void {
    if (ev.type === "RESET_STATE") {
      void this.handleResetState();
      return;
    }

    const oid = resolveOutboxId(ev);
    if (oid === undefined) {
      void applyEvent(this.queryClient, ev);
      return;
    }

    const evVersion = resolveEventVersion(ev);
    if (evVersion > SUPPORTED_REALTIME_EVENT_SCHEMA_VERSION) {
      console.warn("[realtime] event schema newer than client; forcing full resync", {
        type: ev.type,
        eventVersion: evVersion,
        supported: SUPPORTED_REALTIME_EVENT_SCHEMA_VERSION,
      });
      void this.establishBaselineAfterFullRefresh();
      return;
    }

    if (
      this.replaySuppressionMaxId !== null &&
      oid <= this.replaySuppressionMaxId
    ) {
      return;
    }

    if (this.lastAppliedEventId !== null) {
      if (oid <= this.lastAppliedEventId) {
        reportRealtimeTelemetry({ duplicateDrop: true });
        return;
      }
      if (oid !== this.lastAppliedEventId + 1) {
        if (!this.gapRecoveryInFlight) {
          this.gapRecoveryInFlight = (async () => {
            try {
              reportRealtimeTelemetry({ gapResync: true });
              await this.establishBaselineAfterFullRefresh();
            } finally {
              this.gapRecoveryInFlight = null;
            }
          })();
        }
        return;
      }
    }

    this.lastAppliedEventId = oid;
    writeStoredLastOutboxId(oid);
    void applyEvent(this.queryClient, ev);
  }

  /**
   * Apply events from `GET /api/realtime/replay` in order. Sets a suppression watermark so
   * concurrent SSE duplicates (id ≤ max replay id) are ignored in {@link ingest} without telemetry noise.
   */
  async applyReplayBatch(events: readonly RealtimeEvent[]): Promise<void> {
    const maxFromBatch = maxOutboxIdFromReplayBatch(events);
    if (maxFromBatch !== null) {
      this.replaySuppressionMaxId = maxFromBatch;
    }
    try {
      for (const ev of events) {
        if (ev.type === "RESET_STATE") {
          await this.handleResetState();
          continue;
        }

        const oid = resolveOutboxId(ev);
        if (oid === undefined) {
          await applyEvent(this.queryClient, ev);
          continue;
        }

        const evVersion = resolveEventVersion(ev);
        if (evVersion > SUPPORTED_REALTIME_EVENT_SCHEMA_VERSION) {
          console.warn("[realtime] replay batch event schema newer than client; forcing full resync", {
            type: ev.type,
            eventVersion: evVersion,
            supported: SUPPORTED_REALTIME_EVENT_SCHEMA_VERSION,
          });
          await this.establishBaselineAfterFullRefresh();
          return;
        }

        // Phase 9 pre-merge kill pass — monotonic guard.
        // During a reconciliation triggered while the SSE stream is
        // already advancing, `applyReplayBatch` can receive events with
        // oids LOWER than the current `lastAppliedEventId`. Unconditional
        // assignment would regress the cursor (and the localStorage
        // mirror); a subsequent live event then trips false-gap
        // detection. We still apply every event to the cache (the data
        // matters) but the cursor must only advance.
        const shouldAdvance =
          this.lastAppliedEventId === null || oid > this.lastAppliedEventId;
        if (shouldAdvance) {
          this.lastAppliedEventId = oid;
          writeStoredLastOutboxId(oid);
        }
        await applyEvent(this.queryClient, ev);
      }
    } finally {
      this.replaySuppressionMaxId = null;
    }
  }

  /**
   * Fetches every replay page after `fromId` while the server reports `hasMore` (1000 events per page).
   * Skips when there is no stored cursor — initial loads rely on SSE + snapshot queries instead of full history.
   */
  async replayHttpCatchUpAfter(fromId: number | null): Promise<void> {
    if (fromId === null) return;
    if (!Number.isFinite(fromId) || fromId < 0) return;

    let cursor = fromId;
    for (;;) {
      const page = await api.realtime.replay(cursor);
      const events = page.events.map(mapReplayApiRowToRealtimeEvent);
      if (events.length > 0) {
        await this.applyReplayBatch(events);
        const maxId = maxOutboxIdFromReplayBatch(events);
        if (maxId !== null) cursor = maxId;
      }
      if (!page.hasMore) break;
      if (page.events.length === 0) break;
    }
  }

  private async handleResetState(): Promise<void> {
    clearStoredLastOutboxId();
    this.lastAppliedEventId = null;
    await resetRealtimeCaches(this.queryClient);
    try {
      const head = await api.realtime.outboxHead();
      const id = Number(head.maxPublishedId);
      if (!Number.isFinite(id) || id < 0) return;
      this.lastAppliedEventId = id;
      writeStoredLastOutboxId(id);
    } catch {
      // Cursor stays cleared if head fetch fails.
    }
  }
}

function attachSharedStream(): void {
  if (source) return;

  source = new EventSource("/api/realtime/stream");
  source.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data) as unknown;
      // Phase 9 PR 9.4 — intercept structured KEEPALIVE events. These carry
      // the server's view of activeCodeBlueSessionId + reconnect stormHint
      // and are routed only to keepalive subscribers, never to outbox
      // ingestors / legacy handlers.
      if (isKeepaliveEnvelope(parsed)) {
        for (const cb of keepaliveSubscribers) {
          try {
            cb(parsed.payload);
          } catch {
            // never let one subscriber break the others
          }
        }
        return;
      }
      const realtimeEvent = parsed as RealtimeEvent;
      maybeReportPropagation(realtimeEvent);
      for (const ing of ingestors) {
        ing.ingest(realtimeEvent);
      }
      for (const h of legacyHandlers) {
        h(realtimeEvent);
      }
    } catch {
      // Ignore malformed payloads to keep stream alive.
    }
  };
  source.onerror = () => {
    // Browser EventSource handles reconnect automatically.
  };
  source.addEventListener("CONNECTION_EVICTED", () => {
    source?.close();
    source = null;
    toast.info("Reconnecting real-time updates...");
    setTimeout(() => {
      if (streamSubscriptions <= 0) return;
      attachSharedStream();
    }, 2000);
  });
}

export function connectRealtime(
  onEvent: (event: RealtimeEvent) => void,
  options?: { queryClient?: QueryClient; ingestor?: EventIngestor },
): void {
  try {
    if (typeof window === "undefined") return;

    if (!options?.ingestor) {
      legacyHandlers.add(onEvent);
    }
    if (options?.ingestor) {
      ingestors.add(options.ingestor);
    }

    streamSubscriptions += 1;

    attachSharedStream();
  } catch {
    // Realtime is best-effort only.
  }
}

export function disconnectRealtime(options?: {
  ingestor?: EventIngestor;
  legacy?: (event: RealtimeEvent) => void;
}): void {
  try {
    // Phase 9 pre-merge kill pass — only decrement `streamSubscriptions`
    // when an ingestor/legacy handler was actually registered. The
    // display + ER mount pattern starts an async `replayHttpCatchUpAfter`
    // BEFORE calling `connectRealtime`. If the effect cleanup runs while
    // that await is still pending, `connectRealtime` never fires — but
    // the cleanup still calls `disconnectRealtime`. The previous
    // unconditional `streamSubscriptions--` would underflow into the
    // shared count and could kill the SSE source for sibling
    // ingestors (e.g. ER) still active in the same tab. `Set.delete`
    // returns a boolean reflecting whether the item was present, so we
    // use that as the gate.
    let wasSubscribed = false;
    if (options?.ingestor) {
      if (ingestors.delete(options.ingestor)) wasSubscribed = true;
    }
    if (options?.legacy) {
      if (legacyHandlers.delete(options.legacy)) wasSubscribed = true;
    }
    if (wasSubscribed) {
      streamSubscriptions = Math.max(0, streamSubscriptions - 1);
    }
    if (streamSubscriptions <= 0) {
      streamSubscriptions = 0;
      ingestors.clear();
      legacyHandlers.clear();
      source?.close();
      source = null;
    }
  } catch {
    // Ignore close errors.
  }
}
