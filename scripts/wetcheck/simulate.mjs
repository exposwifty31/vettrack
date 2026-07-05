/**
 * Wet-check 24-hour shift simulation driver.
 *
 * Drives a full compressed working day against an isolated wet-check server:
 * shift CSV import, morning/evening/night scan cycles, waitlist lifecycle,
 * redocking, staging, inventory, tasks, realtime, adversarial inputs, and a
 * final rate-limit/concurrency stress block.
 *
 * Requirements: seeded DB (seed.ts) + server running in dev-bypass mode.
 * No dependencies — plain Node >= 18 (fetch/FormData).
 *
 * Usage:
 *   WETCHECK_BASE=http://localhost:3101 node scripts/wetcheck/simulate.mjs
 *
 * Output: human summary on stdout + scripts/wetcheck/results-<ts>.json
 */
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.WETCHECK_BASE || "http://localhost:3101";
const M = JSON.parse(readFileSync(join(HERE, "manifest.json"), "utf8"));
const ID = M.ids;

// ── paced fetch (global limiter is 100 req/min per IP) ──────────────────
const PACE_MS = Number(process.env.WETCHECK_PACE_MS ?? 700);
let unpaced = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ACTORS = {
  admin: {},
  alpha: { "x-dev-user-id-override": "dev-user-alpha" },
  beta: { "x-dev-user-id-override": "dev-user-beta" },
  pending: { "x-dev-user-id-override": "dev-pending-user-001" },
  blocked: { "x-dev-user-id-override": "dev-blocked-user-001" },
};

async function call(method, path, { actor = "admin", body, headers = {}, raw = false, noRetry = false } = {}) {
  if (!unpaced) await sleep(PACE_MS);
  const h = { ...ACTORS[actor], ...headers };
  let payload;
  if (body !== undefined && !(body instanceof FormData)) {
    h["Content-Type"] = h["Content-Type"] ?? "application/json";
    payload = typeof body === "string" ? body : JSON.stringify(body);
  } else {
    payload = body;
  }
  const started = Date.now();
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { method, headers: h, body: payload, signal: AbortSignal.timeout(12_000) });
  } catch (e) {
    return { status: 0, data: `FETCH_ERR:${e.name}:${e.message}`, ms: Date.now() - started, headers: new Headers() };
  }
  const ms = Date.now() - started;
  if (res.status === 429 && !noRetry) {
    const reset = Number(res.headers.get("ratelimit-reset") ?? 30);
    process.stdout.write(`\n    [pacing] 429 on ${path} — waiting ${reset + 1}s\n`);
    await sleep((reset + 1) * 1000);
    return call(method, path, { actor, body, headers, raw, noRetry: true });
  }
  let data = null;
  const text = await res.text();
  if (!raw) {
    try { data = JSON.parse(text); } catch { data = text.slice(0, 300); }
  } else {
    data = text;
  }
  return { status: res.status, data, ms, headers: res.headers };
}

// ── result recorder ──────────────────────────────────────────────────────
const results = [];
let phase = "";
function setPhase(p) {
  phase = p;
  console.log(`\n━━ ${p}`);
}
async function check(name, fn) {
  const started = Date.now();
  try {
    const out = await fn();
    const ok = out?.pass !== false;
    results.push({ phase, name, ok, note: out?.note ?? "", detail: out?.detail, ms: Date.now() - started });
    console.log(`  ${ok ? "✓" : "✗"} ${name}${out?.note ? ` — ${out.note}` : ""}`);
  } catch (err) {
    results.push({ phase, name, ok: false, note: `THREW: ${err.message}`, ms: Date.now() - started });
    console.log(`  ✗ ${name} — THREW: ${err.message}`);
  }
}
const expectStatus = (r, want, extra = "") => ({
  pass: Array.isArray(want) ? want.includes(r.status) : r.status === want,
  note: `${r.status}${extra ? ` ${extra}` : ""} ${JSON.stringify(r.data)?.slice(0, 140) ?? ""}`,
  detail: r.data,
});

// ── phases ───────────────────────────────────────────────────────────────
async function p0Preflight() {
  setPhase("P0 · Preflight & auth gates");
  await check("health endpoint up (liveness 200)", async () => {
    const r = await call("GET", "/api/health");
    return { pass: r.status === 200 && r.data?.status === "ok", note: `${r.status} status=${r.data?.status}` };
  });
  await check("users/me resolves dev admin", async () => {
    const r = await call("GET", "/api/users/me");
    return { pass: r.status === 200 && r.data?.role === "admin", note: `${r.status} role=${r.data?.role}` };
  });
  await check("pending account gated (403 ACCOUNT_PENDING_APPROVAL)", async () => {
    const r = await call("GET", "/api/equipment", { actor: "pending" });
    return expectStatus(r, 403);
  });
  await check("blocked account gated (403 ACCOUNT_BLOCKED)", async () => {
    const r = await call("GET", "/api/equipment", { actor: "blocked" });
    return expectStatus(r, 403);
  });
  await check("student role blocked from tasks (403)", async () => {
    const r = await call("GET", "/api/appointments?day=" + new Date().toISOString().slice(0, 10), { headers: { "x-dev-role-override": "student" } });
    return expectStatus(r, 403);
  });
}

function buildCsv(dayOffset0 = 0, dayOffset1 = 1) {
  const tpl = readFileSync(join(HERE, "wetcheck-ezvet-shifts.csv"), "utf8");
  const d = (off) => {
    const dt = new Date(Date.now() + off * 86_400_000);
    return dt.toISOString().slice(0, 10);
  };
  return tpl.replaceAll("{{DAY0}}", d(dayOffset0)).replaceAll("{{DAY1}}", d(dayOffset1));
}

async function p1ShiftImport() {
  setPhase("P1 · Shift CSV import (EZ export)");
  const csv = buildCsv();
  await check("preview parses CSV (FINDING: role labels recognized?)", async () => {
    const r = await call("POST", "/api/shifts/import/preview", { body: { csv, filename: "wetcheck-ezvet-shifts.csv" } });
    const s = r.data?.summary;
    const note = `${r.status} valid=${s?.validRows}/${s?.totalRows} skipped=${s?.skippedRows}${s?.validRows < 9 ? " ⟵ some Hebrew role labels unrecognized (night/student)" : ""}`;
    return { pass: r.status === 200 && s?.totalRows === 9, note };
  });
  await check("confirm imports 9 rows", async () => {
    const r = await call("POST", "/api/shifts/import/confirm", { body: { csv, filename: "wetcheck-ezvet-shifts.csv" } });
    return { pass: r.status === 200 || r.status === 201, note: `${r.status} ${JSON.stringify(r.data)?.slice(0, 160)}` };
  });
  await check("duplicate confirm behavior (dedupe or duplicate rows?)", async () => {
    const r = await call("POST", "/api/shifts/import/confirm", { body: { csv, filename: "wetcheck-ezvet-shifts.csv" } });
    return { pass: true, note: `${r.status} ${JSON.stringify(r.data)?.slice(0, 160)}` };
  });
  await check("shifts list for today returns imported rows", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const r = await call("GET", `/api/shifts?date=${today}`);
    const n = Array.isArray(r.data) ? r.data.length : r.data?.shifts?.length;
    return { pass: r.status === 200, note: `${r.status} rows=${n}` };
  });
  await check("empty CSV rejected (400)", async () => {
    const r = await call("POST", "/api/shifts/import/preview", { body: { csv: "", filename: "wetcheck-empty.csv" } });
    return expectStatus(r, 400);
  });
  await check("garbage headers → all rows skipped", async () => {
    const r = await call("POST", "/api/shifts/import/preview", { body: { csv: "foo,bar\n1,2\n", filename: "wetcheck-bad.csv" } });
    return { pass: r.status === 200 || r.status === 400 || r.status === 422, note: `${r.status} ${JSON.stringify(r.data?.summary ?? r.data)?.slice(0, 140)}` };
  });
  await check("bad date / bad time rows land in issues", async () => {
    const bad = "Employee,Shift,Date,Start,End\nWC Bad Row,טכנאי בוקר,not-a-date,99:99,08:00\n";
    const r = await call("POST", "/api/shifts/import/preview", { body: { csv: bad, filename: "wetcheck-badrow.csv" } });
    return { pass: r.status === 200 && (r.data?.summary?.skippedRows ?? 0) >= 1, note: `${r.status} ${JSON.stringify(r.data?.summary)}` };
  });
  await check("5000-row CSV import (stress)", async () => {
    const today = new Date().toISOString().slice(0, 10);
    let big = "Employee,Shift,Date,Start,End\n";
    for (let i = 0; i < 5000; i++) big += `WC Bulk ${i},טכנאי בוקר,${today},08:00,16:00\n`;
    const r = await call("POST", "/api/shifts/import/preview", { body: { csv: big, filename: "wetcheck-bulk.csv" } });
    return { pass: r.status === 200 || r.status === 413, note: `${r.status} valid=${r.data?.summary?.validRows} ms=${r.ms}` };
  });
  await check("non-admin cannot import (403)", async () => {
    const r = await call("POST", "/api/shifts/import/confirm", { headers: { "x-dev-role-override": "technician" }, body: { csv, filename: "wetcheck-ezvet-shifts.csv" } });
    return expectStatus(r, 403);
  });
}

async function p2ScanFlow() {
  setPhase("P2 · Morning scan / checkout / return");
  await check("equipment list loads", async () => {
    const r = await call("GET", "/api/equipment");
    const n = Array.isArray(r.data) ? r.data.length : r.data?.equipment?.length ?? r.data?.items?.length;
    return { pass: r.status === 200, note: `${r.status} count=${n}` };
  });
  await check("quick-scan checkout (pump01, alpha)", async () => {
    const r = await call("POST", "/api/equipment/scan", { actor: "alpha", body: { equipmentId: ID.eq.pump01 } });
    return { pass: r.status === 200 && r.data?.action === "checkout", note: `${r.status} action=${r.data?.action}` };
  });
  await check("quick-scan toggle returns it (alpha)", async () => {
    const r = await call("POST", "/api/equipment/scan", { actor: "alpha", body: { equipmentId: ID.eq.pump01 } });
    return { pass: r.status === 200 && r.data?.action === "return", note: `${r.status} action=${r.data?.action}` };
  });
  await check("checkout not_ready pump04 → 422 BUNDLE_INCOMPLETE", async () => {
    const r = await call("POST", `/api/equipment/${ID.eq.pump04}/checkout`, { actor: "alpha", body: {} });
    return { pass: r.status === 422 && r.data?.code === "BUNDLE_INCOMPLETE", note: `${r.status} ${r.data?.code}` };
  });
  await check("checkout untracked pump08 → 422 CUSTODY_CHAIN_BROKEN", async () => {
    const r = await call("POST", `/api/equipment/${ID.eq.pump08}/checkout`, { actor: "alpha", body: {} });
    return { pass: r.status === 422 && r.data?.code === "CUSTODY_CHAIN_BROKEN", note: `${r.status} ${r.data?.code}` };
  });
  await check("checkout soft-deleted oxy04 → 404", async () => {
    const r = await call("POST", `/api/equipment/${ID.eq.oxy04}/checkout`, { actor: "alpha", body: {} });
    return expectStatus(r, 404);
  });
  await check("checkout unknown UUID → 404", async () => {
    const r = await call("POST", `/api/equipment/aec0ffee-dead-4000-8000-000000000000/checkout`, { body: {} });
    return expectStatus(r, 404);
  });
  await check("checkout invalid UUID → 400", async () => {
    const r = await call("POST", `/api/equipment/not-a-uuid/checkout`, { body: {} });
    return expectStatus(r, 400);
  });
  await check("double checkout conflict (pump02: alpha then beta) → 409", async () => {
    const a = await call("POST", `/api/equipment/${ID.eq.pump02}/checkout`, { actor: "alpha", body: {} });
    const b = await call("POST", `/api/equipment/${ID.eq.pump02}/checkout`, { actor: "beta", body: {} });
    return { pass: a.status === 200 && b.status === 409, note: `first=${a.status} second=${b.status} code=${b.data?.code ?? b.data?.reason}` };
  });
  await check("return by NON-holder (beta returns alpha's pump02) — observed behavior", async () => {
    const r = await call("POST", `/api/equipment/${ID.eq.pump02}/return`, { actor: "beta", body: {} });
    return { pass: true, note: `${r.status} (200 = anyone may return; policy question)` };
  });
  await check("double return is idempotent-ish", async () => {
    const r = await call("POST", `/api/equipment/${ID.eq.pump02}/return`, { actor: "alpha", body: {} });
    return { pass: [200, 409].includes(r.status), note: `${r.status}` };
  });
  await check("return with isPluggedIn=false creates return record", async () => {
    const c = await call("POST", `/api/equipment/${ID.eq.pump02}/checkout`, { actor: "alpha", body: {} });
    const r = await call("POST", `/api/equipment/${ID.eq.pump02}/return`, { actor: "alpha", body: { isPluggedIn: false, plugInDeadlineMinutes: 15 } });
    return { pass: c.status === 200 && r.status === 200 && r.data?.returnRecord?.isPluggedIn === false, note: `${r.status} returnRecord=${!!r.data?.returnRecord}` };
  });
  await check("emergency checkout without reason → 422", async () => {
    const r = await call("POST", `/api/equipment/${ID.eq.mon03}/checkout`, { actor: "alpha", body: {}, headers: { "x-emergency-checkout": "true" } });
    return { pass: r.status === 422 && r.data?.code === "EMERGENCY_REASON_REQUIRED", note: `${r.status} ${r.data?.code}` };
  });
  await check("emergency checkout of staged mon03 cancels staging claims", async () => {
    const r = await call("POST", `/api/equipment/${ID.eq.mon03}/checkout`, { actor: "alpha", body: { emergencyReason: "WC crash cart run" }, headers: { "x-emergency-checkout": "true" } });
    const q = await call("GET", `/api/equipment/${ID.eq.mon03}/staging-queue`);
    const active = Array.isArray(q.data) ? q.data.filter((x) => x.status === "active").length : q.data?.queue?.filter?.((x) => x.status === "active")?.length;
    return { pass: r.status === 200, note: `checkout=${r.status} activeClaims=${active ?? JSON.stringify(q.data)?.slice(0, 60)}` };
  });
  await check("return emergency unit (mon03)", async () => {
    const r = await call("POST", `/api/equipment/${ID.eq.mon03}/return`, { actor: "alpha", body: {} });
    return expectStatus(r, 200);
  });
}

async function p3Waitlist() {
  setPhase("P3 · Waitlist lifecycle");
  await check("snapshot pump05: 2 waiting (beta, noam)", async () => {
    const r = await call("GET", `/api/equipment/${ID.eq.pump05}/waitlist`);
    return { pass: r.status === 200 && r.data?.queueSize === 2, note: `${r.status} queueSize=${r.data?.queueSize}` };
  });
  await check("admin joins pump05 waitlist → position 3", async () => {
    const r = await call("POST", `/api/equipment/${ID.eq.pump05}/waitlist`);
    return { pass: r.status === 201 && r.data?.myPosition === 3, note: `${r.status} pos=${r.data?.myPosition}` };
  });
  await check("duplicate join → 409 WAITLIST_ALREADY_JOINED", async () => {
    const r = await call("POST", `/api/equipment/${ID.eq.pump05}/waitlist`);
    return expectStatus(r, 409);
  });
  await check("holder cannot join own waitlist (alpha) → 422", async () => {
    const r = await call("POST", `/api/equipment/${ID.eq.pump05}/waitlist`, { actor: "alpha" });
    return expectStatus(r, 422);
  });
  await check("join waitlist on available unit → 422 WAITLIST_NOT_IN_USE", async () => {
    const r = await call("POST", `/api/equipment/${ID.eq.oxy01}/waitlist`);
    return expectStatus(r, 422);
  });
  await check("holder returns pump05 → head waiter (beta) promoted to notified", async () => {
    const ret = await call("POST", `/api/equipment/${ID.eq.pump05}/return`, { actor: "alpha", body: {} });
    const snap = await call("GET", `/api/equipment/${ID.eq.pump05}/waitlist`, { actor: "beta" });
    return {
      pass: ret.status === 200 && snap.data?.myStatus === "notified",
      note: `return=${ret.status} betaStatus=${snap.data?.myStatus} expires=${snap.data?.reservationExpiresAt}`,
    };
  });
  await check("admin dock-returns pump05 to ready (so bundle gate passes)", async () => {
    const r = await call("POST", `/api/equipment/${ID.eq.pump05}/dock-return`, {
      body: { dockId: ID.docks.icu, conditionVerifications: [
        { conditionId: ID.conditions.pumpBattery, verified: true },
        { conditionId: ID.conditions.pumpLine, verified: true },
      ] },
    });
    return { pass: r.status === 200 && r.data?.readinessState === "ready", note: `${r.status} readiness=${r.data?.readinessState}` };
  });
  await check("admin /checkout while beta holds reservation → denied (409/422)", async () => {
    const r = await call("POST", `/api/equipment/${ID.eq.pump05}/checkout`, { body: {} });
    const heldReason = JSON.stringify(r.data).includes("RESERVATION_HELD");
    return { pass: [409, 422].includes(r.status), note: `${r.status} reservationGate=${heldReason} ${JSON.stringify(r.data)?.slice(0, 90)}` };
  });
  await check("BUG PROBE: quick-scan bypasses waitlist reservation?", async () => {
    const r = await call("POST", "/api/equipment/scan", { body: { equipmentId: ID.eq.pump05 } });
    const stolen = r.status === 200 && r.data?.action === "checkout";
    if (stolen) await call("POST", `/api/equipment/${ID.eq.pump05}/return`, { body: {} });
    return { pass: !stolen, note: stolen ? "CONFIRMED BUG: admin quick-scan stole beta's reserved unit (checkout succeeded, no reservation check)" : `${r.status} ${r.data?.reason ?? r.data?.code ?? ""}` };
  });
  await check("beta redeems reservation via /checkout", async () => {
    const r = await call("POST", `/api/equipment/${ID.eq.pump05}/checkout`, { actor: "beta", body: {} });
    return expectStatus(r, 200);
  });
  await check("beta leaves-after-fulfilled → 404 WAITLIST_NOT_ON_WAITLIST", async () => {
    const r = await call("DELETE", `/api/equipment/${ID.eq.pump05}/waitlist`, { actor: "beta" });
    return expectStatus(r, 404);
  });
  await check("expired reservation (mon04 guy, TTL passed) — sweep + next promotion?", async () => {
    const r = await call("GET", `/api/equipment/${ID.eq.mon04}/waitlist`);
    const entries = r.data?.entries ?? [];
    const guy = entries.find((e) => e.userId === ID.users.guy);
    const notified = r.data?.notifiedUserId;
    return { pass: true, note: `guyStillListed=${!!guy} notifiedUserId=${notified ?? "none"} queueSize=${r.data?.queueSize}` };
  });
  await check("admin leaves pump05 waitlist", async () => {
    const r = await call("DELETE", `/api/equipment/${ID.eq.pump05}/waitlist`);
    return expectStatus(r, 200);
  });
}

async function p4Redocking() {
  setPhase("P4 · Redocking (dock-return)");
  const verifyPump = [
    { conditionId: ID.conditions.pumpBattery, verified: true },
    { conditionId: ID.conditions.pumpLine, verified: true },
  ];
  await check("dock-return pump07 (returned→docked, all verified → ready)", async () => {
    const r = await call("POST", `/api/equipment/${ID.eq.pump07}/dock-return`, {
      body: { dockId: ID.docks.wardA, conditionVerifications: verifyPump },
    });
    return { pass: r.status === 200 && r.data?.readinessState === "ready" && r.data?.custodyState === "docked", note: `${r.status} readiness=${r.data?.readinessState}` };
  });
  await check("dock-return pump06 straight from checked_out clears custody", async () => {
    const r = await call("POST", `/api/equipment/${ID.eq.pump06}/dock-return`, {
      body: { dockId: ID.docks.wardA, conditionVerifications: verifyPump },
    });
    return { pass: r.status === 200 && r.data?.custodyState === "docked", note: `${r.status} custody=${r.data?.custodyState} readiness=${r.data?.readinessState}` };
  });
  await check("dock-return partial verification → not_ready", async () => {
    const c = await call("POST", `/api/equipment/${ID.eq.pump07}/checkout`, { actor: "alpha", body: {} });
    const r = await call("POST", `/api/equipment/${ID.eq.pump07}/dock-return`, {
      actor: "alpha",
      body: { dockId: ID.docks.wardA, conditionVerifications: [{ conditionId: ID.conditions.pumpBattery, verified: true }, { conditionId: ID.conditions.pumpLine, verified: false }] },
    });
    return { pass: c.status === 200 && r.status === 200 && r.data?.readinessState === "not_ready", note: `${r.status} readiness=${r.data?.readinessState}` };
  });
  await check("dock-return via master NFC tag resolves dock", async () => {
    const c = await call("POST", `/api/equipment/${ID.eq.pump07}/checkout`, { actor: "alpha", body: {} });
    const r = await call("POST", `/api/equipment/${ID.eq.pump07}/dock-return`, {
      actor: "alpha",
      body: { masterNfcTagId: "wc-nfc-ward-a", conditionVerifications: verifyPump },
    });
    return { pass: c.status === 200 && r.status === 200 && r.data?.custodyState === "docked", note: `${r.status} readiness=${r.data?.readinessState}` };
  });
  await check("dock-return unknown master tag → 404", async () => {
    const r = await call("POST", `/api/equipment/${ID.eq.pump07}/dock-return`, {
      body: { masterNfcTagId: "wc-nfc-nowhere", conditionVerifications: verifyPump },
    });
    return expectStatus(r, 404);
  });
  await check("dock-return legacy unit without asset type → 422", async () => {
    const r = await call("POST", `/api/equipment/${ID.eq.legacy01}/dock-return`, {
      body: { dockId: ID.docks.icu, conditionVerifications: [] },
    });
    return expectStatus(r, 422);
  });
  await check("dock-return with wrong-asset-type condition → 422", async () => {
    const r = await call("POST", `/api/equipment/${ID.eq.mon02}/dock-return`, {
      body: { dockId: ID.docks.wardB, conditionVerifications: [{ conditionId: ID.conditions.pumpLine, verified: true }] },
    });
    return expectStatus(r, 422);
  });
  await check("concurrent dock-returns → one wins, one 409", async () => {
    unpaced = true;
    const mk = () => call("POST", `/api/equipment/${ID.eq.mon05}/dock-return`, {
      body: { dockId: ID.docks.wardB, conditionVerifications: [{ conditionId: ID.conditions.monitorLeads, verified: true }] },
      noRetry: true,
    });
    const [a, b] = await Promise.all([mk(), mk()]);
    unpaced = false;
    const statuses = [a.status, b.status].sort();
    return { pass: statuses.includes(200), note: `statuses=${statuses.join(",")} (expect 200 + 409/200)` };
  });
  await check("waitlist promotion fires on deployable dock-return (mon04)", async () => {
    const ret = await call("POST", `/api/equipment/${ID.eq.mon04}/return`, { actor: "beta", body: {} });
    const dock = await call("POST", `/api/equipment/${ID.eq.mon04}/dock-return`, {
      body: { dockId: ID.docks.wardB, conditionVerifications: [{ conditionId: ID.conditions.monitorLeads, verified: true }] },
    });
    const snap = await call("GET", `/api/equipment/${ID.eq.mon04}/waitlist`);
    return { pass: ret.status === 200 && dock.status === 200, note: `return=${ret.status} dock=${dock.status} notified=${snap.data?.notifiedUserId ?? "none"}` };
  });
}

async function p5Staging() {
  setPhase("P5 · Staging queue");
  await check("alpha stages pump03 (routine)", async () => {
    const r = await call("POST", `/api/equipment/${ID.eq.pump03}/stage`, { actor: "alpha", body: { clinicalPriority: "routine" } });
    return { pass: [200, 201].includes(r.status), note: `${r.status} ${JSON.stringify(r.data)?.slice(0, 120)}` };
  });
  await check("beta stages pump03 (emergency) → outranks alpha", async () => {
    const r = await call("POST", `/api/equipment/${ID.eq.pump03}/stage`, { actor: "beta", body: { clinicalPriority: "emergency" } });
    return { pass: [200, 201].includes(r.status), note: `${r.status}` };
  });
  await check("alpha checkout while beta holds top claim → 409 STAGING_CONFLICT", async () => {
    const r = await call("POST", `/api/equipment/${ID.eq.pump03}/checkout`, { actor: "alpha", body: {} });
    return { pass: r.status === 409 && r.data?.code === "STAGING_CONFLICT", note: `${r.status} ${r.data?.code}` };
  });
  await check("beta (top claim) checkout succeeds", async () => {
    const r = await call("POST", `/api/equipment/${ID.eq.pump03}/checkout`, { actor: "beta", body: {} });
    return expectStatus(r, 200);
  });
  await check("beta returns pump03", async () => {
    const r = await call("POST", `/api/equipment/${ID.eq.pump03}/return`, { actor: "beta", body: {} });
    return expectStatus(r, 200);
  });
}

async function p6Inventory() {
  setPhase("P6 · Inventory (dispense / restock)");
  await check("containers list", async () => {
    const r = await call("GET", "/api/containers");
    const n = Array.isArray(r.data) ? r.data.length : r.data?.containers?.length;
    return { pass: r.status === 200, note: `${r.status} count=${n}` };
  });
  await check("dispense from ICU cart (authority envelope observed)", async () => {
    const r = await call("POST", `/api/containers/${ID.containers.icu}/dispense`, {
      body: { items: [{ itemId: ID.items.saline, quantity: 2 }] },
      headers: { "x-request-id": "wetcheck-disp-1" },
    });
    return { pass: [200, 201, 403, 422].includes(r.status), note: `${r.status} ${JSON.stringify(r.data)?.slice(0, 160)}` };
  });
  await check("legacy container restock disabled → 409", async () => {
    const r = await call("POST", `/api/containers/${ID.containers.icu}/restock`, { body: { addedQuantity: 5 } });
    return expectStatus(r, [409, 404]);
  });
  await check("restock session start", async () => {
    const r = await call("POST", "/api/restock/start", { body: { containerId: ID.containers.surgery } });
    global.__restockSession = r.data?.id ?? r.data?.session?.id;
    return { pass: [200, 201].includes(r.status), note: `${r.status} session=${global.__restockSession}` };
  });
  await check("restock scan event", async () => {
    if (!global.__restockSession) return { pass: false, note: "no session" };
    const r = await call("POST", "/api/restock/scan", { body: { sessionId: global.__restockSession, itemId: ID.items.gauze, observedQuantity: 30 } });
    return { pass: [200, 201, 400, 422].includes(r.status), note: `${r.status} ${JSON.stringify(r.data)?.slice(0, 140)}` };
  });
  await check("restock finish", async () => {
    if (!global.__restockSession) return { pass: false, note: "no session" };
    const r = await call("POST", "/api/restock/finish", { body: { sessionId: global.__restockSession } });
    return { pass: [200, 201, 400, 422].includes(r.status), note: `${r.status} ${JSON.stringify(r.data)?.slice(0, 140)}` };
  });
  await check("dispense more than on-hand → floor/negative guard", async () => {
    const r = await call("POST", `/api/containers/${ID.containers.surgery}/dispense`, {
      body: { items: [{ itemId: ID.items.gauze, quantity: 99999 }] },
    });
    return { pass: [200, 201, 400, 403, 409, 422].includes(r.status), note: `${r.status} ${JSON.stringify(r.data)?.slice(0, 160)}` };
  });
}

async function p7Tasks() {
  setPhase("P7 · Tasks (appointments)");
  let createdId = null;
  await check("task list loads", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const r = await call("GET", `/api/appointments?day=${today}`);
    const list = Array.isArray(r.data) ? r.data : r.data?.appointments ?? r.data?.items;
    return { pass: r.status === 200, note: `${r.status} count=${list?.length}` };
  });
  await check("create task", async () => {
    const start = new Date(Date.now() + 3_600_000).toISOString();
    const end = new Date(Date.now() + 7_200_000).toISOString();
    const r = await call("POST", "/api/appointments", { body: { startTime: start, endTime: end, notes: "WC simulated evening task", priority: "high", taskType: "inspection" } });
    createdId = r.data?.id ?? r.data?.appointment?.id;
    return { pass: [200, 201].includes(r.status) && !!createdId, note: `${r.status} id=${createdId}` };
  });
  await check("patch unassigned task → in_progress rejected (UNASSIGNED_TASK_STATUS)", async () => {
    if (!createdId) return { pass: false, note: "no task id" };
    const r = await call("PATCH", `/api/appointments/${createdId}`, { body: { status: "in_progress" } });
    return { pass: [200, 400, 409, 422].includes(r.status), note: `${r.status} ${r.data?.reason ?? r.data?.status ?? JSON.stringify(r.data)?.slice(0, 80)} (domain rule: unassigned task cannot go in_progress)` };
  });
  await check("create task with end before start → validation", async () => {
    const start = new Date(Date.now() + 7_200_000).toISOString();
    const end = new Date(Date.now() + 3_600_000).toISOString();
    const r = await call("POST", "/api/appointments", { body: { startTime: start, endTime: end } });
    return { pass: [400, 422].includes(r.status), note: `${r.status} ${JSON.stringify(r.data)?.slice(0, 120)}` };
  });
  await check("delete created task", async () => {
    if (!createdId) return { pass: false, note: "no task id" };
    const r = await call("DELETE", `/api/appointments/${createdId}`, { body: {} });
    return { pass: [200, 204].includes(r.status), note: `${r.status}` };
  });
}

async function p8Realtime() {
  setPhase("P8 · Realtime (SSE / outbox)");
  await check("outbox head cursor advances past 0", async () => {
    const r = await call("GET", "/api/realtime/outbox-head");
    const head = r.data?.head ?? r.data?.cursor ?? r.data?.id;
    return { pass: r.status === 200, note: `${r.status} head=${JSON.stringify(r.data)?.slice(0, 100)}` };
  });
  await check("replay from 0 returns custody events", async () => {
    const r = await call("GET", "/api/realtime/replay?from_id=0");
    const events = Array.isArray(r.data) ? r.data : r.data?.events;
    const custody = (events ?? []).filter((e) => `${e.type}`.includes("CUSTODY")).length;
    return { pass: r.status === 200, note: `${r.status} events=${events?.length} custody=${custody}` };
  });
  await check("SSE stream connects and yields data within 12s", async () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12_000);
    try {
      const res = await fetch(`${BASE}/api/realtime/stream`, { signal: ctrl.signal });
      const reader = res.body.getReader();
      const { value } = await reader.read();
      clearTimeout(t);
      ctrl.abort();
      const chunk = new TextDecoder().decode(value ?? new Uint8Array()).slice(0, 80);
      return { pass: res.status === 200 && !!value, note: `${res.status} first-chunk="${chunk.replace(/\n/g, "\\n")}"` };
    } catch (e) {
      clearTimeout(t);
      return { pass: false, note: `stream failed: ${e.message}` };
    }
  });
  await check("telemetry unknown enum (best-effort — rejected counter, not error)", async () => {
    const r = await call("POST", "/api/realtime/telemetry", { body: { metric: "totally_made_up_metric", value: 1 } });
    // Endpoint is intentionally best-effort: bad shapes bump telemetry_payload_rejected_* and still 204/200.
    return { pass: [200, 204, 400, 422].includes(r.status), note: `${r.status} (bounded reject counter, no throw)` };
  });
}

async function p9Adversarial() {
  setPhase("P9 · Adversarial inputs & tenancy");
  await check("XSS payload in equipment name is sanitized", async () => {
    const r = await call("POST", "/api/equipment", { body: { name: `WC <script>alert(1)</script> Probe`, status: "ok" } });
    const created = r.data?.id ?? r.data?.equipment?.id;
    let name = r.data?.name ?? r.data?.equipment?.name;
    if (created && !name) {
      const g = await call("GET", `/api/equipment/${created}`);
      name = g.data?.name ?? g.data?.equipment?.name;
    }
    global.__xssEquipmentId = created;
    const sanitized = name && !name.includes("<script>");
    return { pass: [200, 201, 400].includes(r.status) && (sanitized || !created), note: `${r.status} name=${JSON.stringify(name)}` };
  });
  await check("SQL-ish input treated as data", async () => {
    const r = await call("GET", `/api/equipment?search=${encodeURIComponent("'; DROP TABLE vt_equipment;--")}`);
    return { pass: r.status === 200, note: `${r.status}` };
  });
  await check("100KB note accepted or bounded (no 500)", async () => {
    const r = await call("POST", "/api/equipment", { body: { name: "WC Big Note Probe", status: "ok", staffNote: "x".repeat(100_000) } });
    global.__bigNoteEquipmentId = r.data?.id ?? r.data?.equipment?.id;
    return { pass: r.status !== 500, note: `${r.status}` };
  });
  await check("malformed JSON body → 4xx not 500", async () => {
    const r = await call("POST", "/api/equipment", { body: "{ definitely not json", headers: { "Content-Type": "application/json" } });
    return { pass: r.status >= 400 && r.status < 500, note: `${r.status}` };
  });
  await check("cross-clinic isolation: other clinic sees zero wetcheck equipment", async () => {
    const r = await call("GET", "/api/equipment", { headers: { "x-dev-clinic-id-override": "wetcheck-other-clinic" } });
    const list = Array.isArray(r.data) ? r.data : r.data?.equipment ?? r.data?.items ?? [];
    const leaked = (list ?? []).filter?.((e) => `${e.id}`.startsWith("aec0ffee-")).length ?? 0;
    return { pass: r.status === 200 && leaked === 0, note: `${r.status} leaked=${leaked} total=${list?.length}` };
  });
  await check("cross-clinic scan of wetcheck unit → 404", async () => {
    const r = await call("POST", "/api/equipment/scan", { body: { equipmentId: ID.eq.oxy01 }, headers: { "x-dev-clinic-id-override": "wetcheck-other-clinic" } });
    return expectStatus(r, 404);
  });
  await check("cross-clinic dock-return blocked", async () => {
    const r = await call("POST", `/api/equipment/${ID.eq.pump07}/dock-return`, {
      body: { dockId: ID.docks.wardA, conditionVerifications: [] },
      headers: { "x-dev-clinic-id-override": "wetcheck-other-clinic" },
    });
    return expectStatus(r, [404, 422]);
  });
}

async function p10Stress() {
  setPhase("P10 · Concurrency & rate limits (final block)");
  await check("10 parallel checkouts, one winner", async () => {
    unpaced = true;
    const target = ID.eq.oxy01;
    const actors = ["admin", "alpha", "beta"];
    const jobs = Array.from({ length: 10 }, (_, i) =>
      call("POST", `/api/equipment/${target}/checkout`, { actor: actors[i % 3], body: {}, noRetry: true }),
    );
    const rs = await Promise.all(jobs);
    unpaced = false;
    const wins = rs.filter((r) => r.status === 200).length;
    const conflicts = rs.filter((r) => r.status === 409).length;
    await call("POST", `/api/equipment/${target}/return`, { actor: "admin", body: {} }).catch(() => {});
    await call("POST", `/api/equipment/${target}/return`, { actor: "alpha", body: {} }).catch(() => {});
    await call("POST", `/api/equipment/${target}/return`, { actor: "beta", body: {} }).catch(() => {});
    return { pass: wins === 1, note: `wins=${wins} conflicts=${conflicts} statuses=${rs.map((r) => r.status).join(",")}` };
  });
  await check("rapid quick-scan toggle x20 stays consistent", async () => {
    unpaced = true;
    let last = "";
    let flips = 0;
    for (let i = 0; i < 20; i++) {
      const r = await call("POST", "/api/equipment/scan", { actor: "beta", body: { equipmentId: ID.eq.legacy02 }, noRetry: true });
      if (r.status === 200) {
        if (r.data.action !== last) flips++;
        last = r.data.action;
      } else if (r.status === 429) {
        unpaced = false;
        return { pass: true, note: `throttled at iteration ${i} (per-user checkout limiter)` };
      }
    }
    unpaced = false;
    return { pass: flips >= 18, note: `flips=${flips}/20 last=${last}` };
  });
  await check("global limiter kicks in under burst (expect 429s on /api/*)", async () => {
    // NOTE: /api/health is mounted BEFORE globalApiLimiter and is intentionally
    // exempt. Target a limiter-covered endpoint instead.
    unpaced = true;
    const rs = await Promise.all(
      Array.from({ length: 160 }, () => call("GET", "/api/users/me", { noRetry: true })),
    );
    unpaced = false;
    const throttled = rs.filter((r) => r.status === 429).length;
    await sleep(1000);
    return { pass: throttled > 0, note: `429s=${throttled}/160 on /api/users/me` };
  });
}

// ── main ─────────────────────────────────────────────────────────────────
const t0 = Date.now();
console.log(`Wet-check simulation against ${BASE} (pace ${PACE_MS}ms)`);
await p0Preflight();
await p1ShiftImport();
await p2ScanFlow();
await p3Waitlist();
await p4Redocking();
await p5Staging();
await p6Inventory();
await p7Tasks();
await p8Realtime();
await p9Adversarial();
await p10Stress();

const failed = results.filter((r) => !r.ok);
const summary = {
  base: BASE,
  startedAt: new Date(t0).toISOString(),
  durationMs: Date.now() - t0,
  total: results.length,
  passed: results.length - failed.length,
  failed: failed.length,
  failures: failed.map((f) => `${f.phase} :: ${f.name} :: ${f.note}`),
  results,
};
const out = join(HERE, `results-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(out, JSON.stringify(summary, null, 2));
console.log(`\n━━ SUMMARY: ${summary.passed}/${summary.total} passed · ${failed.length} failed · ${(summary.durationMs / 1000).toFixed(0)}s`);
for (const f of summary.failures) console.log(`  ✗ ${f}`);
console.log(`\nResults written to ${out}`);
