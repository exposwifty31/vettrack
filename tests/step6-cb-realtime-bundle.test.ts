/**
 * STEP 6 — CB + realtime patch bundle contracts (Program Brain evidence).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("STEP 6 — Code Blue mutations via api.request()", () => {
  it("useCodeBlueSession routes session mutations through api.codeBlue.sessions", () => {
    const src = readFileSync("src/hooks/useCodeBlueSession.ts", "utf8");
    expect(src).toContain("api.codeBlue.sessions.getActive");
    expect(src).toContain("api.codeBlue.sessions.appendLog");
    expect(src).toContain("api.codeBlue.sessions.sendPresence");
    expect(src).not.toMatch(/authFetch\s*\(\s*[`'"]\/api\/code-blue\/sessions/);
  });

  it("code-blue page start/end use api.codeBlue.sessions", () => {
    const src = readFileSync("src/pages/code-blue.tsx", "utf8");
    expect(src).toContain("api.codeBlue.sessions.start");
    expect(src).toContain("api.codeBlue.sessions.end");
    expect(src).not.toMatch(/authFetch\s*\(\s*[`'"]\/api\/code-blue\/sessions/);
  });

  it("optimistic log rolls back only its own entry on failure (R-CB-03)", () => {
    const src = readFileSync("src/hooks/useCodeBlueSession.ts", "utf8");
    // Surgical rollback: on error remove ONLY the optimistic entry by its id —
    // never restore a whole pre-request snapshot (which erased teammates'
    // concurrent entries mid-request, CLICK-PATH-011).
    expect(src).toContain("filter((e) => e.id !== optimisticId)");
    expect(src).not.toMatch(/setQueryData\(ACTIVE_SESSION_QUERY_KEY,\s*previous\)/);
  });

  it("vt_cb_cache clears when session is absent or ended", () => {
    const src = readFileSync("src/hooks/useCodeBlueSession.ts", "utf8");
    expect(src).toContain('data.session.status !== "active"');
    expect(src).toContain("clearCodeBlueSessionCache");
    expect(src).toContain("activeCodeBlueSessionId !== null");
  });
});

describe("STEP 6 — realtime reconnect + cross-tab prune", () => {
  it("EventSource onopen triggers replayHttpCatchUpAfter for ingestors", () => {
    const src = readFileSync("src/lib/realtime.ts", "utf8");
    expect(src).toMatch(/source\.onopen\s*=\s*\(\)\s*=>\s*\{[\s\S]*replayHttpCatchUpAfter/);
  });

  it("clearStoredLastOutboxId publishes cursor after localStorage remove", () => {
    const src = readFileSync("src/lib/realtime.ts", "utf8");
    const fn = src.slice(src.indexOf("function clearStoredLastOutboxId"), src.indexOf("function reportRealtimeTelemetry"));
    expect(fn).toMatch(/removeItem\(LAST_OUTBOX_STORAGE_KEY\)[\s\S]*publishCursor\(0\)/);
  });

  it("peer cursor 0 triggers handleResetState only for matching clinic gossip", () => {
    const src = readFileSync("src/lib/realtime.ts", "utf8");
    expect(src).toContain("shouldApplyPeerPruneReset");
    expect(src).toMatch(/peerCursor === 0[\s\S]*shouldApplyPeerPruneReset[\s\S]*handleResetState/);
    expect(src).toMatch(/payload:\s*clinicId\s*\?\s*\{\s*clinicId\s*\}/);
  });
});

describe("STEP 6 — sync engine multi-tab lock", () => {
  it("processQueue acquires navigator.locks vt-sync-queue", () => {
    const src = readFileSync("src/lib/sync-engine.ts", "utf8");
    expect(src).toContain('SYNC_QUEUE_LOCK_NAME = "vt-sync-queue"');
    expect(src).toMatch(/navigator\.locks\.request\(\s*SYNC_QUEUE_LOCK_NAME/);
  });
});
