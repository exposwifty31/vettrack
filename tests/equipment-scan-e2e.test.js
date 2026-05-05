"use strict";

/**
 * Equipment scan lifecycle — live-server E2E tests.
 *
 * Requires: dev server running on http://127.0.0.1:3001 (dev-bypass auth mode).
 *
 * Run manually:
 *   node tests/equipment-scan-e2e.test.js
 *
 * Each test case creates its own equipment item via POST /api/equipment and
 * cleans up on exit, so the tests are independent and repeatable.
 *
 * Covered flows:
 *   1. Not-found  — scan unknown ID → 404 EQUIPMENT_NOT_FOUND
 *   2. Checkout   — scan available  → 200, action="checkout", status in_use
 *   3. Return     — same user scans again → 200, action="return", status available
 *   4. Blocked    — another user scans held equipment → 409 EQUIPMENT_ALREADY_CHECKED_OUT
 */

const BASE = "http://127.0.0.1:3001";
const RUN_ID = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`  ✅ PASS: ${label}`);
  passed++;
}

function fail(label, detail) {
  console.error(`  ❌ FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
  failed++;
}

function assert(condition, label, detail) {
  if (condition) ok(label);
  else fail(label, detail);
}

async function request(path, init = {}) {
  return fetch(`${BASE}${path}`, init);
}

async function post(path, body = {}, headers = {}) {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function del(path, headers = {}) {
  return request(path, { method: "DELETE", headers });
}

/**
 * Build dev-bypass headers for a given user.
 * User IDs recognised by auth.ts DEV_USER_PRESETS:
 *   "dev-user-alpha" → alpha@vettrack.dev
 *   "dev-user-beta"  → beta@vettrack.dev
 * Default (no override) → dev-admin-001 / admin@vettrack.dev
 */
function devHeaders({ userId, clinicId, role = "admin" } = {}) {
  return {
    ...(userId   ? { "x-dev-user-id-override":   userId }   : {}),
    ...(clinicId ? { "x-dev-clinic-id-override": clinicId } : {}),
    "x-dev-role-override": role,
  };
}

/** POST /api/equipment/scan with retry on 429 */
async function scan(equipmentId, hdrs, retries = 3) {
  for (let i = 0; i < retries; i++) {
    const res = await post("/api/equipment/scan", { equipmentId }, hdrs);
    if (res.status !== 429) return res;
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  return post("/api/equipment/scan", { equipmentId }, hdrs);
}

/** Create a fresh equipment item and return its { id, ...rest }. */
async function createEquipment(suffix, clinicId) {
  const res = await post(
    "/api/equipment",
    {
      name: `Scan E2E ${suffix} ${RUN_ID}`,
      serialNumber: `SE2E-${suffix}-${RUN_ID}`,
      model: "TestModel",
      location: "Lab",
    },
    devHeaders({ clinicId, role: "admin" }),
  );
  if (!res.ok) throw new Error(`createEquipment failed (${res.status})`);
  return res.json();
}

/** Hard-delete created equipment to clean up after tests. */
async function cleanup(ids, clinicId) {
  for (const id of ids) {
    await del(`/api/equipment/${id}`, devHeaders({ clinicId, role: "admin" }));
  }
}

// ─────────────────────────────────────────────────────────────────────────────

async function run() {
  console.log("=== Equipment scan lifecycle — E2E tests ===\n");

  // Health check
  try {
    const health = await request("/api/healthz");
    if (!health.ok) throw new Error(`healthz → ${health.status}`);
    console.log("  Server reachable ✓\n");
  } catch (err) {
    console.error("Dev server is not reachable on :3001. Start it with `pnpm dev`.", err.message);
    process.exit(1);
  }

  const createdIds = [];

  try {
    // ── 1. Not-found ─────────────────────────────────────────────────────────
    console.log("── 1. Not-found flow ──");
    {
      const res = await scan("eq-does-not-exist-" + RUN_ID, devHeaders());
      const body = await res.json();

      assert(res.status === 404, "status is 404", `got ${res.status}`);
      assert(body.reason === "EQUIPMENT_NOT_FOUND", 'reason is "EQUIPMENT_NOT_FOUND"', body.reason);
      assert(body.code === "NOT_FOUND", 'code is "NOT_FOUND"', body.code);
    }
    console.log();

    // ── 2. Checkout flow ──────────────────────────────────────────────────────
    console.log("── 2. Checkout flow ──");
    {
      const item = await createEquipment("CHECKOUT", null);
      createdIds.push(item.id);

      const res = await scan(item.id, devHeaders({ userId: "dev-user-alpha", role: "technician" }));
      const body = await res.json();

      assert(res.status === 200, "status is 200", `got ${res.status}`);
      assert(body.action === "checkout", 'action is "checkout"', body.action);
      assert(body.equipment != null, "response includes equipment object", JSON.stringify(body));
      assert(body.equipment.checkedOutById === "dev-user-alpha", "checkedOutById is caller", body.equipment.checkedOutById);
      assert(body.equipment.checkedOutAt != null, "checkedOutAt is set", body.equipment.checkedOutAt);
      assert(typeof body.scanLogId === "string" && body.scanLogId.length > 0, "scanLogId is present", body.scanLogId);
      assert(typeof body.undoToken === "string" && body.undoToken.length > 0, "undoToken is present", body.undoToken);
    }
    console.log();

    // ── 3. Return flow ────────────────────────────────────────────────────────
    console.log("── 3. Return flow ──");
    {
      const item = await createEquipment("RETURN", null);
      createdIds.push(item.id);

      // First scan → checkout
      const coRes = await scan(item.id, devHeaders({ userId: "dev-user-alpha", role: "technician" }));
      assert(coRes.status === 200, "checkout pre-condition: status 200", `got ${coRes.status}`);
      const coBody = await coRes.json();
      assert(coBody.action === "checkout", 'checkout pre-condition: action "checkout"', coBody.action);

      // Second scan by same user → return
      const retRes = await scan(item.id, devHeaders({ userId: "dev-user-alpha", role: "technician" }));
      const retBody = await retRes.json();

      assert(retRes.status === 200, "return: status is 200", `got ${retRes.status}`);
      assert(retBody.action === "return", 'return: action is "return"', retBody.action);
      assert(retBody.equipment != null, "return: response includes equipment object");
      assert(retBody.equipment.checkedOutById === null, "return: checkedOutById cleared", retBody.equipment.checkedOutById);
      assert(retBody.equipment.checkedOutAt === null, "return: checkedOutAt cleared", retBody.equipment.checkedOutAt);
      assert(typeof retBody.scanLogId === "string" && retBody.scanLogId.length > 0, "return: scanLogId is present", retBody.scanLogId);
      assert(typeof retBody.undoToken === "string" && retBody.undoToken.length > 0, "return: undoToken is present", retBody.undoToken);
      // equipmentReturns row implied by the returnRecord field or just by status
      assert(retBody.equipment.status === "ok", 'return: equipment status is "ok"', retBody.equipment.status);
    }
    console.log();

    // ── 4. Blocked flow ───────────────────────────────────────────────────────
    console.log("── 4. Blocked flow ──");
    {
      const item = await createEquipment("BLOCKED", null);
      createdIds.push(item.id);

      // User A checks out
      const coRes = await scan(item.id, devHeaders({ userId: "dev-user-alpha", role: "technician" }));
      assert(coRes.status === 200, "blocked setup: User A checkout succeeded", `got ${coRes.status}`);
      const coBody = await coRes.json();
      assert(coBody.action === "checkout", 'blocked setup: action is "checkout"');

      // User B scans — should be blocked
      const blockRes = await scan(item.id, devHeaders({ userId: "dev-user-beta", role: "technician" }));
      const blockBody = await blockRes.json();

      assert(blockRes.status === 409, "blocked: status is 409", `got ${blockRes.status}`);
      assert(blockBody.reason === "EQUIPMENT_ALREADY_CHECKED_OUT", 'blocked: reason is "EQUIPMENT_ALREADY_CHECKED_OUT"', blockBody.reason);
      assert(blockBody.code === "CONFLICT", 'blocked: code is "CONFLICT"', blockBody.code);
      assert(
        blockBody.checkedOutByEmail === "alpha@vettrack.dev",
        "blocked: checkedOutByEmail identifies the holder",
        blockBody.checkedOutByEmail,
      );

      // Verify equipment state was NOT mutated by the blocked scan
      const stateRes = await request(`/api/equipment/${item.id}`, { headers: devHeaders({ role: "admin" }) });
      const stateBody = await stateRes.json();
      assert(stateRes.status === 200, "blocked: GET equipment returns 200 for verification", `got ${stateRes.status}`);
      assert(stateBody.checkedOutById === "dev-user-alpha", "blocked: checkedOutById still User A (not overwritten)", stateBody.checkedOutById);
    }
    console.log();

    // ── 5. eq1 smoke (seed fixture) ───────────────────────────────────────────
    console.log("── 5. eq1 seed-fixture smoke ──");
    {
      // Verify eq1 is reachable (requires seed:dev:e2e to have been run).
      // We only assert the not-checked-out state; we do NOT mutate eq1 here
      // so this test remains side-effect free for the seed fixture.
      const res = await request("/api/equipment/eq1", { headers: devHeaders({ role: "admin" }) });
      if (res.status === 200) {
        const body = await res.json();
        ok('GET /api/equipment/eq1 returns 200 (seed fixture present)');
        assert(body.id === "eq1", 'eq1: id matches', body.id);
        assert(body.status === "ok", 'eq1: status is "ok"', body.status);
      } else if (res.status === 404) {
        fail(
          'GET /api/equipment/eq1 returned 404 — run "pnpm seed:dev:e2e" to create the fixture',
          `status ${res.status}`,
        );
      } else {
        fail('GET /api/equipment/eq1 unexpected status', `got ${res.status}`);
      }
    }
    console.log();

  } catch (err) {
    fail("Unexpected test runner error", err instanceof Error ? err.message : String(err));
  } finally {
    if (createdIds.length > 0) {
      await cleanup(createdIds, null);
    }
  }

  const total = passed + failed;
  console.log(`Results: ${passed}/${total} passed${failed > 0 ? `, ${failed} FAILED` : " ✓"}`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Test process crashed:", err);
  process.exit(1);
});
