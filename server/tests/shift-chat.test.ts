/**
 * Shift-chat auth / role-gate smoke tests.
 * Run with: npx tsx server/tests/shift-chat.test.ts  (or `pnpm test:server:smoke`)
 * Requires: the dev server running on http://localhost:3001.
 * NOT part of `pnpm test` (vitest) — this is a live-server script; see the
 * test:server:smoke npm script and the sibling server/tests/security.test.ts.
 */
const BASE = "http://localhost:3001";
let passed = 0;
let failed = 0;

function ok(label: string) { console.log(`  ✅ PASS: ${label}`); passed++; }
function fail(label: string, detail?: string) { console.error(`  ❌ FAIL: ${label}${detail ? ` — ${detail}` : ""}`); failed++; }

async function get(path: string, opts?: RequestInit) {
  return fetch(`${BASE}${path}`, opts);
}
async function post(path: string, body?: unknown, opts?: RequestInit) {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...opts,
  });
}

// ─── Auth / role gate tests ───────────────────────────────────────────────────

async function testGetRequiresAuth() {
  const res = await get("/api/shift-chat/messages");
  res.status === 401 ? ok("GET requires auth") : fail("GET requires auth", `got ${res.status}`);
}

async function testStudentDenied() {
  const res = await get("/api/shift-chat/messages", {
    headers: { "x-dev-role-override": "student" },
  });
  res.status === 403 ? ok("Student denied GET") : fail("Student denied GET", `got ${res.status}`);
}

async function testGetReturnsShape() {
  const res = await get("/api/shift-chat/messages", {
    headers: { "x-dev-role-override": "technician" },
  });
  if (!res.ok) { fail("GET returns 200", `got ${res.status}`); return; }
  const body = await res.json();
  Array.isArray(body.messages) && "pinnedMessage" in body && Array.isArray(body.typing) && Array.isArray(body.onlineUserIds)
    ? ok("GET returns correct shape")
    : fail("GET shape wrong", JSON.stringify(body));
}

async function testPostRequiresAuth() {
  const res = await post("/api/shift-chat/messages", { body: "hi", type: "regular" });
  res.status === 401 ? ok("POST requires auth") : fail("POST requires auth", `got ${res.status}`);
}

async function testBroadcastBlockedForTech() {
  const res = await post(
    "/api/shift-chat/messages",
    { body: "", type: "broadcast", broadcastKey: "department_close" },
    { headers: { "x-dev-role-override": "technician" } },
  );
  res.status === 403 ? ok("Technician cannot broadcast") : fail("Broadcast block", `got ${res.status}`);
}

async function testBodyTooLong() {
  const res = await post(
    "/api/shift-chat/messages",
    { body: "x".repeat(1001), type: "regular" },
    { headers: { "x-dev-role-override": "technician" } },
  );
  res.status === 400 ? ok("Body > 1000 chars rejected") : fail("Body length guard", `got ${res.status}`);
}

async function testAckRequiresAuth() {
  const res = await post("/api/shift-chat/messages/fake/ack", { status: "acknowledged" });
  res.status === 401 ? ok("Ack requires auth") : fail("Ack auth", `got ${res.status}`);
}

async function testAckInvalidStatus() {
  const res = await post(
    "/api/shift-chat/messages/fake/ack",
    { status: "wrong" },
    { headers: { "x-dev-role-override": "technician" } },
  );
  res.status === 400 ? ok("Invalid ack status rejected") : fail("Ack validation", `got ${res.status}`);
}

async function testPinRequiresSenior() {
  const res = await post("/api/shift-chat/messages/fake/pin", undefined, {
    headers: { "x-dev-role-override": "technician" },
  });
  res.status === 403 ? ok("Technician cannot pin") : fail("Pin RBAC", `got ${res.status}`);
}

async function testPinAllowedForDoctor() {
  // vet role has level 30, senior_technician requirement is level 25 — should pass
  const res = await post("/api/shift-chat/messages/fake/pin", undefined, {
    headers: { "x-dev-role-override": "vet" },
  });
  // Will 404 (message not found) or 409 (no open shift) rather than 403 — that's the correct allowed behaviour
  res.status !== 403 ? ok("Doctor allowed to pin (gets 404/409, not 403)") : fail("Doctor pin allowed", `got ${res.status}`);
}

async function testReactionInvalidEmoji() {
  const res = await post(
    "/api/shift-chat/reactions",
    { messageId: "fake", emoji: "🔥" },
    { headers: { "x-dev-role-override": "technician" } },
  );
  res.status === 400 ? ok("Invalid emoji rejected") : fail("Emoji validation", `got ${res.status}`);
}

async function testTypingUpdatesPresence() {
  const res = await post("/api/shift-chat/typing", undefined, {
    headers: { "x-dev-role-override": "technician" },
  });
  res.ok ? ok("Typing endpoint returns 200") : fail("Typing endpoint", `got ${res.status}`);
}

async function testArchiveRequiresSenior() {
  const res = await get("/api/shift-chat/archive/fake-shift", {
    headers: { "x-dev-role-override": "technician" },
  });
  res.status === 403 ? ok("Technician cannot access archive") : fail("Archive RBAC", `got ${res.status}`);
}

// ─── Runner ───────────────────────────────────────────────────────────────────

async function run() {
  console.log("=== Shift Chat Integration Tests ===\n");
  try {
    const health = await get("/api/health");
    if (!health.ok) throw new Error(`health ${health.status}`);
    console.log("Server reachable ✓\n");
  } catch {
    console.error("Server not reachable — start with: pnpm dev");
    process.exit(1);
  }

  await testGetRequiresAuth();
  await testStudentDenied();
  await testGetReturnsShape();
  await testPostRequiresAuth();
  await testBroadcastBlockedForTech();
  await testBodyTooLong();
  await testAckRequiresAuth();
  await testAckInvalidStatus();
  await testPinRequiresSenior();
  await testPinAllowedForDoctor();
  await testReactionInvalidEmoji();
  await testTypingUpdatesPresence();
  await testArchiveRequiresSenior();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
