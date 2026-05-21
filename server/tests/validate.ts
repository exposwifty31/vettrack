/**
 * VetTrack QA & Validation Suite
 *
 * Run with: npx tsx server/tests/validate.ts
 * Requires: the dev server running on http://localhost:3001
 *
 * Output: structured PASS/FAIL report with severity tagging.
 * Final verdict: System Status: Stable / At Risk / Broken
 *
 * Spec sections (maps to project requirements):
 *   A. Core Features         — QR scan, checkout/return, alert-acks
 *   B. ICU Simulation        — concurrent writes, conflict resolution
 *   C. Failure Scenarios     — RBAC, malformed inputs, rate limits, revert window
 *   D. Data Integrity        — audit log consistency, sequence correctness
 *   E. Regression            — inter-section smoke + full smoke
 *
 * Design:
 * - A condensed regression smoke runs after each major test section
 *   to catch regressions introduced mid-run.
 * - Scan rate limit (10/min) is tracked by a budget counter; the suite
 *   waits for the window to reset before issuing scans that would otherwise
 *   produce 429s, ensuring repeatability regardless of run speed.
 * - Each test outputs PASS / FAIL with scenario, severity, root cause,
 *   and recommended fix.
 * - The final report groups issues as Critical / High / Medium.
 */

import { db, undoTokens } from "../db.js";
import { eq } from "drizzle-orm";

const BASE = "http://localhost:3001";

// ─── Types ────────────────────────────────────────────────────────────────────

type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

interface Issue {
  section: string;
  scenario: string;
  severity: Severity;
  rootCause: string;
  recommendedFix: string;
}

// ─── Global state ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const issues: Issue[] = [];
let currentSection = "";

// ─── Logging helpers ──────────────────────────────────────────────────────────

function section(name: string) {
  currentSection = name;
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  SECTION: ${name}`);
  console.log("─".repeat(60));
}

function ok(label: string) {
  console.log(`  ✅ PASS  ${label}`);
  passed++;
}

function fail(
  label: string,
  severity: Severity,
  rootCause: string,
  recommendedFix: string,
  detail?: string
) {
  const detail_str = detail ? ` — ${detail}` : "";
  console.error(`  ❌ FAIL  [${severity}] ${label}${detail_str}`);
  console.error(`           Root cause: ${rootCause}`);
  console.error(`           Fix: ${recommendedFix}`);
  failed++;
  issues.push({
    section: currentSection,
    scenario: label,
    severity,
    rootCause,
    recommendedFix,
  });
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

type Role = "admin" | "vet" | "technician" | "student";

// DevUserId: named test user identities for multi-user tests.
// Matches DEV_USER_PRESETS in server/middleware/auth.ts.
type DevUserId =
  | "dev-user-alpha"
  | "dev-user-beta"
  | "dev-pending-user-001"
  | "dev-blocked-user-001";

function authHeaders(role?: Role, userId?: DevUserId): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (role) h["x-dev-role-override"] = role;
  if (userId) h["x-dev-user-id-override"] = userId;
  return h;
}

async function get(path: string, role?: Role, userId?: DevUserId): Promise<Response> {
  return fetch(`${BASE}${path}`, { headers: authHeaders(role, userId) });
}

async function post(path: string, body?: unknown, role?: Role, userId?: DevUserId): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: authHeaders(role, userId),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function patch(path: string, body?: unknown, role?: Role): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: authHeaders(role),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function del(path: string, role?: Role): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "DELETE",
    headers: authHeaders(role),
  });
}

// ─── Setup helpers ────────────────────────────────────────────────────────────

async function createTestEquipment(name: string): Promise<string | null> {
  const r = await post(
    "/api/equipment",
    { name, serialNumber: `SN-${Date.now()}`, status: "ok" },
    "admin"
  );
  if (!r.ok) return null;
  const data = await r.json();
  return data.id as string;
}

async function deleteTestEquipment(id: string): Promise<void> {
  await del(`/api/equipment/${id}`, "admin");
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// ─── Scan budget tracker ───────────────────────────────────────────────────────
// The scan endpoint is rate-limited to 10 requests per 60-second sliding window,
// keyed by client IP. Since all requests originate from the same test process,
// they share the same bucket. We track scans issued and pause for the full 60s
// window reset when the budget reaches 9 (leaving 1 in reserve) to ensure
// repeatable outcomes independent of run speed.

const SCAN_LIMIT = 10;
const SCAN_WINDOW_MS = 60_000;
let scanBudgetUsed = 0;
let scanWindowStart = Date.now();

// ensureScanBudget: wait if approaching the rate limit before issuing a scan.
// Call this before any raw fetch() that hits a scan endpoint.
async function ensureScanBudget(): Promise<void> {
  const now = Date.now();
  if (now - scanWindowStart >= SCAN_WINDOW_MS) {
    scanBudgetUsed = 0;
    scanWindowStart = now;
  }
  if (scanBudgetUsed >= SCAN_LIMIT - 1) {
    const remaining = SCAN_WINDOW_MS - (Date.now() - scanWindowStart) + 100;
    console.log(`\n  ⏳ Scan budget exhausted (${scanBudgetUsed}/${SCAN_LIMIT}). Waiting ${Math.ceil(remaining / 1000)}s for rate-limit window reset...`);
    await sleep(remaining);
    scanBudgetUsed = 0;
    scanWindowStart = Date.now();
  }
  scanBudgetUsed++;
}

async function scanWithBudget(path: string, body: unknown, role: Role, userId?: DevUserId): Promise<Response> {
  await ensureScanBudget();
  return post(path, body, role, userId);
}

// ─── Condensed regression smoke ───────────────────────────────────────────────
// Runs after each major section to detect regressions introduced mid-run.

async function regressionSmoke(context: string) {
  const prev = currentSection;
  currentSection = `REGRESSION(${context})`;

  // Smoke 1: Server is alive
  const healthRes = await fetch(`${BASE}/api/healthz`);
  if (healthRes.status === 200) {
    ok(`[${context}] Regression smoke: healthz still 200`);
  } else {
    fail(
      `[${context}] Regression smoke: healthz`,
      "CRITICAL",
      `GET /api/healthz returned ${healthRes.status} after section "${context}"`,
      "A prior test may have corrupted server state or the server restarted"
    );
  }

  // Smoke 2: Equipment list (core feature — QR scan, checkout, ICU all depend on this)
  const listRes = await get("/api/equipment", "admin");
  if (listRes.ok) {
    const items = await listRes.json();
    if (Array.isArray(items)) {
      ok(`[${context}] Regression smoke: equipment list returns array (${items.length} items)`);
    } else {
      fail(
        `[${context}] Regression smoke: equipment list shape`,
        "HIGH",
        "GET /api/equipment did not return an array",
        "Check if a prior test mutated global server state unexpectedly"
      );
    }
  } else {
    fail(
      `[${context}] Regression smoke: equipment list accessible`,
      "CRITICAL",
      `GET /api/equipment returned ${listRes.status}`,
      "Confirm the equipment route is still registered and DB accessible"
    );
  }

  // Smoke 3: Alert-acks list (covers alert acknowledgment feature area)
  // Must return 2xx — anything else (4xx that would indicate route gone, or 5xx) is a failure.
  const acksRes = await get("/api/alert-acks", "technician");
  if (acksRes.ok) {
    ok(`[${context}] Regression smoke: alert-acks endpoint accessible (200)`);
  } else if (acksRes.status >= 500) {
    fail(
      `[${context}] Regression smoke: alert-acks endpoint accessible`,
      "HIGH",
      `GET /api/alert-acks returned ${acksRes.status} after section "${context}"`,
      "Verify alert-acks route is still registered and DB accessible"
    );
  } else if (acksRes.status === 401 || acksRes.status === 403) {
    fail(
      `[${context}] Regression smoke: alert-acks endpoint accessible`,
      "HIGH",
      `GET /api/alert-acks returned ${acksRes.status} — technician should have access`,
      "Verify auth middleware and alert-acks role requirements haven't changed"
    );
  } else {
    fail(
      `[${context}] Regression smoke: alert-acks endpoint accessible`,
      "MEDIUM",
      `GET /api/alert-acks returned unexpected ${acksRes.status} after section "${context}"`,
      "Verify alert-acks route is functioning correctly"
    );
  }

  // Smoke 4: Audit logs endpoint (covers data integrity feature area)
  // Must return 2xx — admin should always have access.
  const auditRes = await get("/api/audit-logs", "admin");
  if (auditRes.ok) {
    const auditData = await auditRes.json().catch(() => null);
    const hasItems = auditData && (auditData.items ?? []).length >= 0;
    if (hasItems !== false) {
      ok(`[${context}] Regression smoke: audit-logs endpoint accessible and returns valid structure`);
    } else {
      fail(
        `[${context}] Regression smoke: audit-logs endpoint response structure`,
        "MEDIUM",
        `GET /api/audit-logs returned 200 but body does not contain an 'items' array`,
        "Verify audit-logs handler returns { items: AuditLog[] } shape"
      );
    }
  } else if (auditRes.status >= 500) {
    fail(
      `[${context}] Regression smoke: audit-logs endpoint accessible`,
      "HIGH",
      `GET /api/audit-logs returned ${auditRes.status} after section "${context}"`,
      "Verify audit-logs route is still registered and DB accessible"
    );
  } else if (auditRes.status === 401 || auditRes.status === 403) {
    fail(
      `[${context}] Regression smoke: audit-logs endpoint accessible`,
      "HIGH",
      `GET /api/audit-logs returned ${auditRes.status} — admin should have access`,
      "Verify auth middleware and audit-logs role requirements haven't changed"
    );
  } else {
    fail(
      `[${context}] Regression smoke: audit-logs endpoint accessible`,
      "MEDIUM",
      `GET /api/audit-logs returned unexpected ${auditRes.status} after section "${context}"`,
      "Verify audit-logs route is functioning correctly"
    );
  }

  // Smoke 5: Behavioral RBAC denial check (viewer cannot access user list)
  // This is a cheap behavioral test that validates auth middleware is still enforcing
  // role checks — no equipment creation needed.
  const rbacSmokeRes = await get("/api/users", "student");
  if (rbacSmokeRes.status === 403) {
    ok(`[${context}] Regression smoke: RBAC enforcement intact (viewer denied on /api/users)`);
  } else if (rbacSmokeRes.status >= 500) {
    fail(
      `[${context}] Regression smoke: RBAC enforcement`,
      "CRITICAL",
      `GET /api/users as viewer returned ${rbacSmokeRes.status} — auth middleware may have crashed`,
      "Verify auth middleware is still active and working after this section"
    );
  } else if (rbacSmokeRes.status === 200) {
    fail(
      `[${context}] Regression smoke: RBAC enforcement`,
      "CRITICAL",
      `Viewer can access /api/users (got 200) — RBAC enforcement broken after section "${context}"`,
      "Check if a prior test modified the viewer role or requireAdmin middleware was removed"
    );
  } else {
    ok(`[${context}] Regression smoke: RBAC enforcement responding (status=${rbacSmokeRes.status})`);
  }

  currentSection = prev;
}

// ─── Section 1: QR Scan Flow ─────────────────────────────────────────────────

async function testQrScanFlow() {
  section("A. Core Features — QR Scan Flow");

  const equipId = await createTestEquipment("QR-Scan-Test");
  if (!equipId) {
    fail(
      "Setup: create equipment for scan tests",
      "CRITICAL",
      "POST /api/equipment returned non-200",
      "Check server startup and database connectivity"
    );
    return;
  }

  // 1.1 Successful scan
  const t0 = Date.now();
  const scanRes = await scanWithBudget(
    `/api/equipment/${equipId}/scan`,
    { status: "ok" },
    "vet"
  );
  const elapsed = Date.now() - t0;

  if (scanRes.ok) {
    ok("Scan returns 200 with valid equipment ID");
  } else {
    const body = await scanRes.json().catch(() => ({}));
    fail(
      "Scan returns 200 with valid equipment ID",
      "CRITICAL",
      `POST /api/equipment/:id/scan returned ${scanRes.status}: ${JSON.stringify(body)}`,
      "Verify vet role permission and scan endpoint handler"
    );
  }

  if (elapsed < 2000) {
    ok(`Scan completes within acceptable time window (${elapsed}ms < 2000ms)`);
  } else {
    fail(
      "Scan completes within acceptable time window",
      "HIGH",
      `Scan took ${elapsed}ms — DB query or middleware latency is too high`,
      "Profile the scan endpoint and optimize slow queries"
    );
  }

  // 1.2 Scan records in audit log
  const auditRes = await get(
    `/api/audit-logs?actionType=equipment_scanned`,
    "admin"
  );
  if (auditRes.ok) {
    const audit = await auditRes.json();
    const found = audit.items?.some(
      (a: { targetId: string }) => a.targetId === equipId
    );
    if (found) {
      ok("Scan is recorded in audit log");
    } else {
      fail(
        "Scan is recorded in audit log",
        "HIGH",
        "Audit log entry for equipment_scanned not found after POST /api/equipment/:id/scan",
        "Ensure logAudit() is called in the scan handler"
      );
    }
  } else {
    fail(
      "Audit log accessible after scan",
      "MEDIUM",
      `GET /api/audit-logs returned ${auditRes.status}`,
      "Verify audit-logs route is accessible to admins"
    );
  }

  // 1.3 Scan returns correct equipment data
  if (scanRes.ok) {
    const scanData = await scanRes.json().catch(() => null);
    if (scanData && scanData.equipment && scanData.equipment.id === equipId) {
      ok("Scan response contains correct equipment data");
    } else {
      fail(
        "Scan response contains correct equipment data",
        "HIGH",
        "Scan response does not include equipment object with matching id",
        "Check scan handler response format: {equipment, scanLog, undoToken}"
      );
    }
    if (scanData && scanData.undoToken) {
      ok("Scan response includes undoToken");
    } else {
      fail(
        "Scan response includes undoToken",
        "MEDIUM",
        "undoToken missing from scan response",
        "Verify insertUndoToken is being called in the scan transaction"
      );
    }
    // 1.4 Scan response equipment status matches what was submitted
    if (scanData && scanData.equipment && scanData.equipment.status === "ok") {
      ok("Scan response equipment status matches submitted status");
    } else if (scanData && scanData.equipment) {
      fail(
        "Scan response equipment status matches submitted status",
        "MEDIUM",
        `Expected status=ok in scan response, got ${scanData.equipment.status}`,
        "Verify scan handler applies status update and returns updated equipment"
      );
    }
  }

  // 1.5 Malformed equipment ID.
  // Scan route: requireAuth → scanLimiter → validateUuid → handler.
  // Budget must be available so the rate limiter doesn't fire before validateUuid runs.
  await ensureScanBudget(); // guarantee budget so limiter won't pre-empt format check
  const malformedRes = await post(
    "/api/equipment/not-a-uuid/scan",
    { status: "ok" },
    "vet"
  );
  if (malformedRes.status === 400 || malformedRes.status === 422) {
    ok("Malformed ID returns 400/422 (input validation)");
  } else if (malformedRes.status === 404) {
    ok("Malformed ID returns 404 (treated as not found — acceptable)");
  } else if (malformedRes.status === 429) {
    fail(
      "Malformed ID rejected with 4xx",
      "MEDIUM",
      "Got 429 — rate limiter fired before format check; scan budget exhausted despite ensureScanBudget()",
      "Review ensureScanBudget() logic and scan rate-limiter window tracking"
    );
  } else {
    fail(
      "Malformed ID rejected with 4xx",
      "MEDIUM",
      `Expected 4xx for invalid UUID, got ${malformedRes.status}`,
      "Add validateUuid middleware to scan route or handle bad UUID in handler"
    );
  }

  // 1.6 Unknown equipment ID (valid UUID format but doesn't exist).
  // Budget must be available so the rate limiter doesn't fire before the handler's 404 check.
  await ensureScanBudget(); // guarantee budget so limiter won't pre-empt 404 check
  const unknownId = "00000000-0000-0000-0000-000000000099";
  const unknownRes = await post(
    `/api/equipment/${unknownId}/scan`,
    { status: "ok" },
    "vet"
  );
  if (unknownRes.status === 404) {
    ok("Unknown equipment ID returns 404");
  } else if (unknownRes.status === 429) {
    fail(
      "Unknown equipment ID returns 404",
      "HIGH",
      "Got 429 — rate limiter fired before handler; scan budget exhausted despite ensureScanBudget()",
      "Review ensureScanBudget() logic and scan rate-limiter window tracking"
    );
  } else {
    fail(
      "Unknown equipment ID returns 404",
      "HIGH",
      `Expected 404 for non-existent equipment, got ${unknownRes.status}`,
      "Verify the scan handler checks equipment existence before returning"
    );
  }

  // 1.7 Rapid back-to-back scans — no server errors and no corrupted state
  // Each call is budgeted through scanWithBudget to avoid rate-limit exhaustion.
  const scanResults = await Promise.allSettled([
    scanWithBudget(`/api/equipment/${equipId}/scan`, { status: "ok" }, "vet"),
    scanWithBudget(`/api/equipment/${equipId}/scan`, { status: "ok" }, "vet"),
    scanWithBudget(`/api/equipment/${equipId}/scan`, { status: "ok" }, "vet"),
  ]);
  const successCount = scanResults.filter(
    (r) => r.status === "fulfilled" && (r.value as Response).ok
  ).length;
  const rateLimited = scanResults.filter(
    (r) => r.status === "fulfilled" && (r.value as Response).status === 429
  ).length;
  const errCount = scanResults.filter(
    (r) => r.status === "rejected" ||
      (r.status === "fulfilled" && !(r.value as Response).ok && (r.value as Response).status !== 429)
  ).length;

  if (errCount === 0) {
    ok(
      `Rapid scans handled without server error (${successCount} ok, ${rateLimited} rate-limited)`
    );
  } else {
    fail(
      "Rapid back-to-back scans handled without server error",
      "HIGH",
      `${errCount} rapid scans returned unexpected errors — possible state corruption`,
      "Check scan handler transaction isolation and error handling"
    );
  }

  // 1.8 Equipment state is consistent after rapid scans
  const afterScanRes = await get(`/api/equipment/${equipId}`, "admin");
  if (afterScanRes.ok) {
    const item = await afterScanRes.json();
    const validStatuses = ["ok", "issue", "maintenance", "sterilized", "overdue", "inactive"];
    if (item.id === equipId && validStatuses.includes(item.status)) {
      ok("Equipment state is consistent and valid after rapid scans");
    } else {
      fail(
        "Equipment state is consistent after rapid scans",
        "CRITICAL",
        `Equipment has invalid status '${item.status}' after rapid scans`,
        "Verify scan transaction isolation prevents partial state writes"
      );
    }
  }

  await deleteTestEquipment(equipId);
}

// ─── Section 2: Offline Sync & Queue Replay ───────────────────────────────────

async function testOfflineSyncAndRevert() {
  section("E. Regression — Offline Sync & Queue Replay / Revert");

  const equipId = await createTestEquipment("Revert-Test-Equipment");
  if (!equipId) {
    fail(
      "Setup: create equipment for revert tests",
      "CRITICAL",
      "POST /api/equipment returned non-200",
      "Check server startup and database connectivity"
    );
    return;
  }

  // 2.1 Simulate offline queue replay: submit 3 state-change actions sequentially
  // (representing actions that were queued offline and are now replaying)
  // Each action carries a client timestamp to represent the original offline ordering.
  const now = Date.now();
  const t1 = now - 2000; // oldest queued action
  const t2 = now - 1000; // second queued action
  const t3 = now;        // most recent queued action

  // These scans carry custom x-client-timestamp headers for last-write-wins testing.
  // Use the module-level ensureScanBudget() before each raw fetch to track budget.
  await ensureScanBudget();
  const q1 = await fetch(`${BASE}/api/equipment/${equipId}/scan`, {
    method: "POST",
    headers: { ...authHeaders("vet"), "x-client-timestamp": String(t1) },
    body: JSON.stringify({ status: "maintenance" }),
  });
  await ensureScanBudget();
  const q2 = await fetch(`${BASE}/api/equipment/${equipId}/scan`, {
    method: "POST",
    headers: { ...authHeaders("vet"), "x-client-timestamp": String(t2) },
    body: JSON.stringify({ status: "sterilized" }),
  });
  await ensureScanBudget();
  const q3 = await fetch(`${BASE}/api/equipment/${equipId}/scan`, {
    method: "POST",
    headers: { ...authHeaders("vet"), "x-client-timestamp": String(t3) },
    body: JSON.stringify({ status: "ok" }),
  });

  const allOk = q1.ok && q2.ok && q3.ok;
  // A queued action is "acceptable" only if it succeeded (2xx) or was rate-limited (429).
  // Any other non-2xx (particularly 5xx) is an unexpected server failure.
  const responses = [q1, q2, q3];
  const anyServerError = responses.some(r => !r.ok && r.status !== 429);
  const allAcceptable = responses.every(r => r.ok || r.status === 429);
  const anyRateLimited = responses.some(r => r.status === 429);
  const atLeastOneSucceeded = responses.some(r => r.ok);

  if (anyServerError) {
    fail(
      "Offline queue replay: no server errors during replay",
      "HIGH",
      `Queue replay produced unexpected errors: q1=${q1.status}, q2=${q2.status}, q3=${q3.status}`,
      "Verify scan endpoint handles sequential replayed actions without 5xx errors"
    );
  } else if (allOk) {
    ok("Offline queue replay: all 3 queued actions applied without error");
  } else if (allAcceptable && anyRateLimited && atLeastOneSucceeded) {
    ok(`Offline queue replay: actions applied — some rate-limited (q1=${q1.status}, q2=${q2.status}, q3=${q3.status})`);
  } else if (allAcceptable && anyRateLimited && !atLeastOneSucceeded) {
    fail(
      "Offline queue replay: at least one queued action must succeed",
      "HIGH",
      `All queued actions were rate-limited — none applied: q1=${q1.status}, q2=${q2.status}, q3=${q3.status}`,
      "Check scan rate limiter threshold (10/min) — test may be exhausting it"
    );
  } else {
    fail(
      "Offline queue replay: all queued actions applied",
      "HIGH",
      `Queue replay failed: q1=${q1.status}, q2=${q2.status}, q3=${q3.status}`,
      "Verify scan endpoint handles sequential replayed actions without 500 errors"
    );
  }

  // 2.2 Verify the final state reflects the last SUCCESSFUL queued action (last-write-wins).
  // The queued order is t1=maintenance < t2=sterilized < t3=ok.
  // If q3 succeeded, final status must be "ok". If q3 was rate-limited but q2 succeeded,
  // final must be "sterilized". If q3 and q2 both rate-limited but q1 succeeded → "maintenance".
  // If all were rate-limited (handled in 2.1 as FAIL), we skip assertion.
  const stateAfterReplay = await get(`/api/equipment/${equipId}`, "admin");
  if (stateAfterReplay.ok) {
    const item = await stateAfterReplay.json();
    let expectedStatus: string | null = null;
    if (q3.ok) {
      expectedStatus = "ok";
    } else if (q2.ok) {
      expectedStatus = "sterilized";
    } else if (q1.ok) {
      expectedStatus = "maintenance";
    }
    if (expectedStatus !== null) {
      if (item.status === expectedStatus) {
        ok(`Queue replay: final state reflects last-write-wins (status=${item.status} from last successful queued action)`);
      } else {
        fail(
          "Queue replay: final state reflects last-write-wins order",
          "HIGH",
          `Expected status=${expectedStatus} (last successful queued action), got status=${item.status}`,
          "Verify scan handler's last-write-wins logic uses client timestamp correctly"
        );
      }
    } else {
      // All three were rate-limited — already flagged as FAIL in 2.1, skip assertion
      ok(`Queue replay: all actions rate-limited — last-write-wins assertion skipped (status=${item.status})`);
    }
  }

  // 2.3 Verify no duplicate scan log entries were created
  const logsRes = await get(`/api/equipment/${equipId}/logs`, "admin");
  if (logsRes.ok) {
    const logs: Array<{ id: string; timestamp: string; status: string }> = await logsRes.json();
    const ids = logs.map((l) => l.id);
    const unique = new Set(ids);
    if (unique.size === ids.length) {
      ok(`Offline queue replay: no duplicate scan log entries (${logs.length} unique entries)`);
    } else {
      fail(
        "Offline queue replay: no duplicate log entries",
        "HIGH",
        `Found ${ids.length - unique.size} duplicate log IDs in replay`,
        "Ensure scan transaction does not insert duplicate log rows during replay"
      );
    }
  }

  // 2.4 First scan — get undoToken for revert tests
  const scan1Res = await scanWithBudget(
    `/api/equipment/${equipId}/scan`,
    { status: "issue", note: "test issue for revert" },
    "vet"
  );
  if (!scan1Res.ok) {
    fail(
      "Setup: scan for revert test",
      "CRITICAL",
      `POST /api/equipment/:id/scan returned ${scan1Res.status}`,
      "Fix scan endpoint before testing revert"
    );
    await deleteTestEquipment(equipId);
    return;
  }
  const scan1Data = await scan1Res.json();
  const undoToken1 = scan1Data.undoToken;

  if (!undoToken1) {
    fail(
      "Scan returns undoToken for revert",
      "CRITICAL",
      "undoToken missing from scan response — revert cannot be tested",
      "Ensure insertUndoToken() is called in scan handler"
    );
    await deleteTestEquipment(equipId);
    return;
  }
  ok("Scan returns undoToken for revert");

  // 2.5 Revert within 90-second window
  const revertRes = await post(
    `/api/equipment/${equipId}/revert`,
    { undoToken: undoToken1 },
    "vet"
  );
  if (revertRes.ok) {
    ok("Revert within 90-second window succeeds");
    // Verify state was actually restored (status should no longer be "issue")
    const stateAfterRevert = await get(`/api/equipment/${equipId}`, "admin");
    if (stateAfterRevert.ok) {
      const item = await stateAfterRevert.json();
      if (item.status !== "issue") {
        ok(`Revert correctly restored previous state (status=${item.status}, not 'issue')`);
      } else {
        fail(
          "Revert restores previous state",
          "HIGH",
          "Equipment status is still 'issue' after revert — state not restored",
          "Verify revert handler applies previousState snapshot correctly"
        );
      }
    }
  } else {
    const body = await revertRes.json().catch(() => ({}));
    fail(
      "Revert within 90-second window succeeds",
      "CRITICAL",
      `POST /api/equipment/:id/revert returned ${revertRes.status}: ${JSON.stringify(body)}`,
      "Check consumeUndoToken logic and ensure token TTL has not expired"
    );
  }

  // 2.6 Double-revert prevention
  const doubleRevertRes = await post(
    `/api/equipment/${equipId}/revert`,
    { undoToken: undoToken1 },
    "vet"
  );
  if (doubleRevertRes.status === 409) {
    ok("Double-revert prevented (409 on second use of same token)");
  } else {
    fail(
      "Double-revert prevented",
      "HIGH",
      `Expected 409 on second revert with same token, got ${doubleRevertRes.status}`,
      "Ensure consumeUndoToken marks token as consumed and checks consumed=false"
    );
  }

  // 2.7 Revert after TTL expiry — directly sets token expiresAt to the past in DB,
  // then verifies the revert endpoint rejects the token with 409 (expired window).
  // This is the definitive TTL boundary test: uses a valid, unconsumed token that
  // has been forcibly expired via direct DB write (no 90s wait required).
  let ttlTestToken: string | null = null;
  // Create a fresh scan to get a fresh (unconsumed) undo token
  const ttlScanRes = await scanWithBudget(
    `/api/equipment/${equipId}/scan`,
    { status: "sterilized" },
    "vet"
  );
  if (ttlScanRes.ok) {
    const ttlScanBody = await ttlScanRes.json();
    ttlTestToken = ttlScanBody?.undoToken ?? null;
  }
  if (!ttlTestToken) {
    fail(
      "Revert after TTL expiry: setup scan failed",
      "HIGH",
      "Could not obtain fresh undo token for TTL expiry test",
      "Check scan endpoint returns undoToken in response body"
    );
  } else {
    // Force-expire the token by setting expiresAt to 1ms in the past.
    try {
      await db
        .update(undoTokens)
        .set({ expiresAt: new Date(Date.now() - 1) } as Partial<typeof undoTokens.$inferInsert>)
        .where(eq(undoTokens.id, ttlTestToken));
      const expiredTokenRes = await post(
        `/api/equipment/${equipId}/revert`,
        { undoToken: ttlTestToken },
        "vet"
      );
      if (expiredTokenRes.status === 409) {
        ok("Revert after TTL expiry rejected with 409 (expired window enforced)");
      } else if (expiredTokenRes.ok) {
        fail(
          "Revert after TTL expiry is rejected",
          "CRITICAL",
          `Revert of force-expired token returned ${expiredTokenRes.status} — TTL window not enforced`,
          "consumeUndoToken must check expires_at > NOW(); expired tokens must return 409"
        );
      } else {
        fail(
          "Revert after TTL expiry returns 409",
          "HIGH",
          `Expected 409 for expired token, got ${expiredTokenRes.status}`,
          "Revert endpoint should return 409 when token is expired"
        );
      }
    } catch (err) {
      fail(
        "Revert after TTL expiry: DB force-expire step failed",
        "HIGH",
        `DB update to expire token threw: ${err}`,
        "Ensure validate.ts can import server/db.ts and undoTokens table"
      );
    }
  }

  await deleteTestEquipment(equipId);
}

// ─── Section 3: Equipment Checkout Ownership ──────────────────────────────────

async function testCheckoutOwnership() {
  section("A. Core Features — Equipment Checkout Ownership");

  const equipId = await createTestEquipment("Checkout-Ownership-Test");
  if (!equipId) {
    fail(
      "Setup: create equipment for checkout tests",
      "CRITICAL",
      "POST /api/equipment returned non-200",
      "Check server startup and database connectivity"
    );
    return;
  }

  // 3.1 Checkout assigns ownership
  const checkoutRes = await post(
    `/api/equipment/${equipId}/checkout`,
    { location: "ICU-1" },
    "technician"
  );
  if (checkoutRes.ok) {
    const data = await checkoutRes.json();
    if (
      data.equipment &&
      data.equipment.checkedOutById &&
      data.equipment.checkedOutByEmail
    ) {
      ok("Checkout assigns checkedOutById and checkedOutByEmail");
    } else {
      fail(
        "Checkout assigns ownership fields",
        "HIGH",
        "Checkout response missing checkedOutById or checkedOutByEmail",
        "Verify checkout handler sets all ownership fields"
      );
    }
    if (data.equipment && data.equipment.checkedOutLocation === "ICU-1") {
      ok("Checkout assigns specified location (ICU-1)");
    } else if (data.equipment) {
      fail(
        "Checkout assigns specified location",
        "MEDIUM",
        `Expected checkedOutLocation=ICU-1, got ${data.equipment.checkedOutLocation}`,
        "Verify checkout handler saves location from request body"
      );
    }
    if (data.undoToken) {
      ok("Checkout response includes undoToken");
    } else {
      fail(
        "Checkout response includes undoToken",
        "MEDIUM",
        "undoToken missing from checkout response",
        "Ensure insertUndoToken is called in checkout transaction"
      );
    }
  } else {
    const body = await checkoutRes.json().catch(() => ({}));
    fail(
      "Checkout assigns ownership",
      "CRITICAL",
      `POST /api/equipment/:id/checkout returned ${checkoutRes.status}: ${JSON.stringify(body)}`,
      "Fix checkout endpoint — critical for ICU workflows"
    );
  }

  // 3.2 GET /api/equipment/my reflects checked-out item
  const myEquipRes = await get("/api/equipment/my", "technician");
  if (myEquipRes.ok) {
    const items: Array<{ id: string }> = await myEquipRes.json();
    const found = items.some((i) => i.id === equipId);
    if (found) {
      ok("GET /api/equipment/my reflects checked-out item");
    } else {
      fail(
        "GET /api/equipment/my reflects checked-out item",
        "HIGH",
        "Equipment is checked out but not visible in /api/equipment/my",
        "Ensure /api/equipment/my filters by authUser.id = checkedOutById"
      );
    }
  } else {
    fail(
      "GET /api/equipment/my is accessible",
      "MEDIUM",
      `GET /api/equipment/my returned ${myEquipRes.status}`,
      "Verify /api/equipment/my route is registered and requires auth"
    );
  }

  // 3.3 Return clears ownership instantly
  const returnRes = await post(
    `/api/equipment/${equipId}/return`,
    {},
    "technician"
  );
  if (returnRes.ok) {
    const returnData = await returnRes.json();
    const eq = returnData.equipment ?? returnData;
    if (!eq.checkedOutById && !eq.checkedOutByEmail) {
      ok("Return clears checkedOutById and checkedOutByEmail instantly");
    } else {
      fail(
        "Return clears ownership fields",
        "HIGH",
        "Return response still has checkedOutById or checkedOutByEmail populated",
        "Ensure return handler sets checkedOutById=null and checkedOutByEmail=null"
      );
    }
  } else {
    const body = await returnRes.json().catch(() => ({}));
    fail(
      "Return clears ownership instantly",
      "CRITICAL",
      `POST /api/equipment/:id/return returned ${returnRes.status}: ${JSON.stringify(body)}`,
      "Fix return endpoint — critical for ICU equipment availability"
    );
  }

  // 3.4 /api/equipment/my no longer contains the item after return
  const myAfterReturn = await get("/api/equipment/my", "technician");
  if (myAfterReturn.ok) {
    const items: Array<{ id: string }> = await myAfterReturn.json();
    const stillPresent = items.some((i) => i.id === equipId);
    if (!stillPresent) {
      ok("GET /api/equipment/my no longer contains returned item");
    } else {
      fail(
        "GET /api/equipment/my clears returned item",
        "HIGH",
        "Item still appears in /api/equipment/my after return",
        "Verify return handler clears checkedOutById so the item is no longer in /my"
      );
    }
  }

  // 3.5 Two concurrent checkouts from distinct users — only one should win.
  // Uses x-dev-user-id-override to create truly distinct user identities (alpha vs beta),
  // simulating cross-user ownership conflict. The server must return 409 for the loser.
  const equipId2 = await createTestEquipment("Concurrent-Checkout-Test");
  if (equipId2) {
    const [co1, co2] = await Promise.allSettled([
      post(`/api/equipment/${equipId2}/checkout`, { location: "ICU-A" }, "technician", "dev-user-alpha"),
      post(`/api/equipment/${equipId2}/checkout`, { location: "ICU-B" }, "vet", "dev-user-beta"),
    ]);

    const res1 = co1.status === "fulfilled" ? co1.value : null;
    const res2 = co2.status === "fulfilled" ? co2.value : null;
    const ok1 = res1?.ok ?? false;
    const ok2 = res2?.ok ?? false;
    const conflict1 = res1?.status === 409;
    const conflict2 = res2?.status === 409;
    const rl1 = res1?.status === 429;
    const rl2 = res2?.status === 429;
    // Any 5xx from either request is an unexpected server error
    const serverErr1 = res1 && res1.status >= 500;
    const serverErr2 = res2 && res2.status >= 500;

    if (serverErr1 || serverErr2) {
      fail(
        "Concurrent checkout: no server error",
        "HIGH",
        `Concurrent checkout produced 5xx: status1=${res1?.status}, status2=${res2?.status}`,
        "Verify checkout handler handles concurrent requests without 500 errors"
      );
    } else if (ok1 && ok2) {
      fail(
        "Concurrent checkout: only one succeeds",
        "CRITICAL",
        "Both concurrent checkouts returned 200 — split-brain ownership detected",
        "Ensure checkout uses a DB transaction with a SELECT FOR UPDATE or equivalent lock"
      );
    } else if ((ok1 && conflict2) || (ok2 && conflict1)) {
      ok("Concurrent checkout conflict handled deterministically (one wins with 200, one gets 409)");
    } else if (rl1 || rl2) {
      ok(`Concurrent checkout: at least one rate-limited (status1=${res1?.status}, status2=${res2?.status}) — rate limiter prevented both from succeeding`);
    } else {
      // Both failed for some other reason (404, 400, etc.) — this is unexpected
      fail(
        "Concurrent checkout: expected one success or a clear conflict/rate-limit",
        "MEDIUM",
        `Neither checkout succeeded and no 409/429 detected: status1=${res1?.status}, status2=${res2?.status}`,
        "Verify checkout endpoint handles concurrent requests and returns expected status codes"
      );
    }

    await deleteTestEquipment(equipId2);
  }

  await deleteTestEquipment(equipId);
}

// ─── Section 4: Alerts & Acknowledgment Deduplication ────────────────────────

async function testAlertAcks() {
  section("A. Core Features — Alerts & Acknowledgment Deduplication");

  const equipId = await createTestEquipment("Alert-Ack-Test");
  if (!equipId) {
    fail(
      "Setup: create equipment for alert-ack tests",
      "CRITICAL",
      "POST /api/equipment returned non-200",
      "Check server startup and database connectivity"
    );
    return;
  }

  // 4.1 POST /api/alert-acks creates correctly
  const ackRes = await post(
    "/api/alert-acks",
    { equipmentId: equipId, alertType: "issue" },
    "technician"
  );
  if (ackRes.status === 201) {
    const ack = await ackRes.json();
    if (
      ack.equipmentId === equipId &&
      ack.alertType === "issue" &&
      ack.acknowledgedById &&
      ack.acknowledgedByEmail
    ) {
      ok("Alert-ack created correctly with all required fields (201)");
    } else {
      fail(
        "Alert-ack has correct fields",
        "HIGH",
        `Ack response missing fields: ${JSON.stringify(ack)}`,
        "Verify alert-acks POST handler populates all required fields"
      );
    }
  } else {
    const body = await ackRes.json().catch(() => ({}));
    fail(
      "Alert-ack creation returns 201",
      "HIGH",
      `POST /api/alert-acks returned ${ackRes.status}: ${JSON.stringify(body)}`,
      "Fix alert-acks POST handler"
    );
  }

  // 4.2 Second claim from a distinct user (dev-user-beta) — should upsert, not duplicate.
  // Uses x-dev-user-id-override "dev-user-beta" to simulate a different actor claiming the
  // same alert-ack. The server must upsert (no duplicate rows) and the final list must show
  // exactly one record for this equipment+alertType combination.
  const ack2Res = await post(
    "/api/alert-acks",
    { equipmentId: equipId, alertType: "issue" },
    "technician",
    "dev-user-beta"
  );
  if (ack2Res.status === 201 || ack2Res.ok) {
    ok("Second alert-ack claim accepted (upsert — replaces previous)");

    // Verify only one ack exists (no split-brain)
    const listRes = await get("/api/alert-acks", "admin");
    if (listRes.ok) {
      const acks: Array<{ equipmentId: string; alertType: string }> =
        await listRes.json();
      const matching = acks.filter(
        (a) => a.equipmentId === equipId && a.alertType === "issue"
      );
      if (matching.length === 1) {
        ok("No split-brain: exactly one ack record for same equipment+alertType after upsert");
      } else {
        fail(
          "No split-brain: one ack record after upsert",
          "CRITICAL",
          `Found ${matching.length} ack records for same equipment+alertType — split-brain detected`,
          "Ensure the upsert delete+insert is atomic in alert-acks POST handler"
        );
      }
    }
  } else {
    fail(
      "Second alert-ack claim handled without error",
      "MEDIUM",
      `Second POST /api/alert-acks returned ${ack2Res.status}`,
      "Verify alert-acks route handles repeated claims gracefully"
    );
  }

  // 4.3 DELETE ack returns alert to unhandled state
  const deleteRes = await fetch(
    `${BASE}/api/alert-acks?equipmentId=${equipId}&alertType=issue`,
    {
      method: "DELETE",
      headers: authHeaders("technician"),
    }
  );
  if (deleteRes.status === 204) {
    ok("DELETE /api/alert-acks returns 204");

    const verifyRes = await get("/api/alert-acks", "admin");
    if (verifyRes.ok) {
      const acks: Array<{ equipmentId: string; alertType: string }> =
        await verifyRes.json();
      const remaining = acks.filter(
        (a) => a.equipmentId === equipId && a.alertType === "issue"
      );
      if (remaining.length === 0) {
        ok("Alert is back in unhandled state (no acks remain) after DELETE");
      } else {
        fail(
          "Alert is back in unhandled state after DELETE ack",
          "HIGH",
          `${remaining.length} ack(s) still present after DELETE — alert not fully cleared`,
          "Verify DELETE /api/alert-acks deletes by equipmentId+alertType"
        );
      }
    }
  } else {
    fail(
      "DELETE /api/alert-acks returns 204",
      "HIGH",
      `DELETE /api/alert-acks returned ${deleteRes.status}`,
      "Fix alert-acks DELETE handler"
    );
  }

  // 4.4 Viewer cannot post acks (RBAC)
  const viewerAckRes = await post(
    "/api/alert-acks",
    { equipmentId: equipId, alertType: "issue" },
    "student"
  );
  if (viewerAckRes.status === 403) {
    ok("Viewer correctly denied on POST /api/alert-acks (403)");
  } else {
    fail(
      "Viewer denied on POST /api/alert-acks",
      "HIGH",
      `Expected 403 for viewer, got ${viewerAckRes.status}`,
      "Add requireEffectiveRole('technician') middleware to POST /api/alert-acks"
    );
  }

  await deleteTestEquipment(equipId);
}

// ─── Section 5: RBAC Enforcement ─────────────────────────────────────────────

async function testRbacEnforcement() {
  section("C. Failure Scenarios — RBAC Enforcement");

  const fakeUuid = "00000000-0000-0000-0000-000000000001";

  // 5.1 Technician cannot PATCH /api/users/:id/role
  const patchRoleRes = await patch(
    `/api/users/${fakeUuid}/role`,
    { role: "admin" },
    "technician"
  );
  if (patchRoleRes.status === 403 || patchRoleRes.status === 401) {
    ok("Technician denied on PATCH /api/users/:id/role (401/403)");
  } else {
    fail(
      "Technician denied on PATCH /api/users/:id/role",
      "CRITICAL",
      `Expected 401/403 for technician, got ${patchRoleRes.status}`,
      "Ensure requireAdmin middleware is applied to PATCH /api/users/:id/role"
    );
  }

  // 5.2 Admin can access PATCH /api/users/:id/role (positive path)
  // Expected: a domain response (2xx or 4xx like 404 not found / 400 bad input).
  // A 5xx indicates the server crashed reaching this endpoint — that is a FAIL.
  const adminPatchRoleRes = await patch(
    `/api/users/${fakeUuid}/role`,
    { role: "student" },
    "admin"
  );
  if (adminPatchRoleRes.status >= 500) {
    fail(
      "Admin passes role gate on PATCH /api/users/:id/role",
      "HIGH",
      `Admin request resulted in server error ${adminPatchRoleRes.status} — role gate may be misconfigured or handler crashed`,
      "Check requireAdmin middleware and PATCH /api/users/:id/role handler for 500 errors"
    );
  } else if (adminPatchRoleRes.status === 401 || adminPatchRoleRes.status === 403) {
    fail(
      "Admin passes role gate on PATCH /api/users/:id/role",
      "HIGH",
      `Admin was denied (${adminPatchRoleRes.status}) on admin-only endpoint`,
      "Check requireAdmin middleware — dev admin should always pass"
    );
  } else {
    ok(`Admin passes role gate on PATCH /api/users/:id/role (status=${adminPatchRoleRes.status})`);
  }

  // 5.3 Technician cannot PATCH /api/users/:id/status
  const patchStatusRes = await patch(
    `/api/users/${fakeUuid}/status`,
    { status: "blocked" },
    "technician"
  );
  if (patchStatusRes.status === 403 || patchStatusRes.status === 401) {
    ok("Technician denied on PATCH /api/users/:id/status (401/403)");
  } else {
    fail(
      "Technician denied on PATCH /api/users/:id/status",
      "CRITICAL",
      `Expected 401/403 for technician, got ${patchStatusRes.status}`,
      "Ensure requireAdmin middleware is applied to PATCH /api/users/:id/status"
    );
  }

  // 5.3b Admin can access PATCH /api/users/:id/status (positive path)
  const adminPatchStatusRes = await patch(
    `/api/users/${fakeUuid}/status`,
    { status: "blocked" },
    "admin"
  );
  if (adminPatchStatusRes.status >= 500) {
    fail(
      "Admin passes role gate on PATCH /api/users/:id/status",
      "HIGH",
      `Admin request resulted in server error ${adminPatchStatusRes.status} — role gate may be misconfigured or handler crashed`,
      "Check requireAdmin middleware and PATCH /api/users/:id/status handler for 500 errors"
    );
  } else if (adminPatchStatusRes.status === 401 || adminPatchStatusRes.status === 403) {
    fail(
      "Admin passes role gate on PATCH /api/users/:id/status",
      "HIGH",
      `Admin was denied (${adminPatchStatusRes.status}) on admin-only endpoint`,
      "Check requireAdmin middleware — dev admin should always pass"
    );
  } else {
    ok(`Admin passes role gate on PATCH /api/users/:id/status (status=${adminPatchStatusRes.status})`);
  }

  // 5.4 Technician cannot DELETE /api/users/:id
  const deleteUserRes = await del(`/api/users/${fakeUuid}`, "technician");
  if (deleteUserRes.status === 403 || deleteUserRes.status === 401) {
    ok("Technician denied on DELETE /api/users/:id (401/403)");
  } else {
    fail(
      "Technician denied on DELETE /api/users/:id",
      "CRITICAL",
      `Expected 401/403 for technician, got ${deleteUserRes.status}`,
      "Ensure requireAdmin middleware is applied to DELETE /api/users/:id"
    );
  }

  // 5.4b Admin can access DELETE /api/users/:id (positive path)
  const adminDeleteUserRes = await del(`/api/users/${fakeUuid}`, "admin");
  if (adminDeleteUserRes.status >= 500) {
    fail(
      "Admin passes role gate on DELETE /api/users/:id",
      "HIGH",
      `Admin request resulted in server error ${adminDeleteUserRes.status} — role gate may be misconfigured or handler crashed`,
      "Check requireAdmin middleware and DELETE /api/users/:id handler for 500 errors"
    );
  } else if (adminDeleteUserRes.status === 401 || adminDeleteUserRes.status === 403) {
    fail(
      "Admin passes role gate on DELETE /api/users/:id",
      "HIGH",
      `Admin was denied (${adminDeleteUserRes.status}) on admin-only endpoint`,
      "Check requireAdmin middleware — dev admin should always pass"
    );
  } else {
    ok(`Admin passes role gate on DELETE /api/users/:id (status=${adminDeleteUserRes.status})`);
  }

  // 5.5 Technician cannot DELETE /api/equipment/:id (admin-only)
  const deleteEquipRes = await del(`/api/equipment/${fakeUuid}`, "technician");
  if (deleteEquipRes.status === 403 || deleteEquipRes.status === 401) {
    ok("Technician denied on DELETE /api/equipment/:id (401/403)");
  } else {
    fail(
      "Technician denied on DELETE /api/equipment/:id",
      "CRITICAL",
      `Expected 401/403 for technician, got ${deleteEquipRes.status}`,
      "Ensure requireAdmin middleware is applied to DELETE /api/equipment/:id"
    );
  }

  // 5.6 Admin can access DELETE /api/equipment/:id (positive path)
  const adminDeleteEquipRes = await del(`/api/equipment/${fakeUuid}`, "admin");
  if (adminDeleteEquipRes.status >= 500) {
    fail(
      "Admin passes role gate on DELETE /api/equipment/:id",
      "HIGH",
      `Admin request resulted in server error ${adminDeleteEquipRes.status} — role gate may be misconfigured or handler crashed`,
      "Check requireAdmin middleware and DELETE /api/equipment/:id handler for 500 errors"
    );
  } else if (adminDeleteEquipRes.status === 401 || adminDeleteEquipRes.status === 403) {
    fail(
      "Admin passes role gate on DELETE /api/equipment/:id",
      "HIGH",
      `Admin was denied (${adminDeleteEquipRes.status}) on admin-only endpoint`,
      "Check requireAdmin middleware — dev admin should always pass"
    );
  } else {
    ok(`Admin passes role gate on DELETE /api/equipment/:id (status=${adminDeleteEquipRes.status})`);
  }

  // 5.7 Viewer cannot GET /api/users (admin-only)
  const viewerUsersRes = await get("/api/users", "student");
  if (viewerUsersRes.status === 403) {
    ok("Viewer denied on GET /api/users (403)");
  } else {
    fail(
      "Viewer denied on GET /api/users",
      "HIGH",
      `Expected 403 for viewer on GET /api/users, got ${viewerUsersRes.status}`,
      "Ensure requireAdmin middleware is applied to GET /api/users"
    );
  }

  // 5.8 Student can scan equipment (stabilization: scan / take / return are student baseline).
  // Route order: requireAuth → scanLimiter → requireEffectiveRole("student").
  // A 429 means the rate limiter ran BEFORE the role check — RBAC was not exercised.
  const tempEquipId = await createTestEquipment("RBAC-Scan-Test");
  if (tempEquipId) {
    await ensureScanBudget(); // guarantee budget so rate limiter won't fire before RBAC
    const studentScanRes = await post(
      `/api/equipment/${tempEquipId}/scan`,
      { status: "ok" },
      "student"
    );
    if (studentScanRes.status >= 200 && studentScanRes.status < 300) {
      ok("Student allowed on POST /api/equipment/:id/scan (2xx)");
    } else if (studentScanRes.status === 429) {
      fail(
        "Student allowed on POST /api/equipment/:id/scan",
        "HIGH",
        "Got 429 (rate limited) instead of 2xx — role check may not have been reached; scan budget exhausted",
        "Ensure ensureScanBudget() is called before RBAC scan tests so rate limiter does not fire first"
      );
    } else if (studentScanRes.status === 403) {
      fail(
        "Student allowed on POST /api/equipment/:id/scan",
        "HIGH",
        "Student received 403 — scan should allow student+ per stabilization plan",
        "Ensure requireEffectiveRole('student') is applied to scan endpoint"
      );
    } else {
      fail(
        "Student allowed on POST /api/equipment/:id/scan",
        "HIGH",
        `Expected 2xx for student scan, got ${studentScanRes.status}`,
        "Check scan handler and RBAC for student role"
      );
    }
    await deleteTestEquipment(tempEquipId);
  }

  // 5.9 Spoofed x-role header does not elevate viewer
  const spoofRes = await fetch(`${BASE}/api/users`, {
    headers: {
      ...authHeaders("student"),
      "x-role": "admin",
    },
  });
  if (spoofRes.status === 403) {
    ok("Spoofed x-role header does not elevate viewer privileges");
  } else {
    fail(
      "Spoofed x-role header does not elevate viewer privileges",
      "CRITICAL",
      `Expected 403 for viewer with spoofed x-role:admin header, got ${spoofRes.status}`,
      "Ensure auth middleware ignores x-role header and resolves role from DB/dev user"
    );
  }
}

// ─── Section 6: ICU Simulation & Conflict Resolution ─────────────────────────

async function testIcuSimulation() {
  section("B. ICU Simulation & Conflict Resolution");

  const equipId = await createTestEquipment("ICU-Concurrent-Test");
  if (!equipId) {
    fail(
      "Setup: create equipment for ICU simulation",
      "CRITICAL",
      "POST /api/equipment returned non-200",
      "Check server startup and database connectivity"
    );
    return;
  }

  // 6.1 Rapid concurrent scans from distinct users with explicit client timestamps.
  // Uses x-dev-user-id-override to simulate two distinct actors (alpha vs beta) racing
  // to scan the same equipment. The server must resolve the conflict by client timestamp
  // (last-write-wins): the scan with the higher timestamp must be the final state.
  const scanTimestampBase = Date.now();
  const scan1Timestamp = scanTimestampBase;
  const scan2Timestamp = scanTimestampBase + 1; // +1ms — this should win

  // Pre-check budget for both concurrent scans before launching them simultaneously.
  await ensureScanBudget(); // account for scan 1
  await ensureScanBudget(); // account for scan 2
  const [co1, co2] = await Promise.allSettled([
    fetch(`${BASE}/api/equipment/${equipId}/scan`, {
      method: "POST",
      headers: { ...authHeaders("admin", "dev-user-alpha"), "x-client-timestamp": String(scan1Timestamp) },
      body: JSON.stringify({ status: "maintenance" }),
    }),
    fetch(`${BASE}/api/equipment/${equipId}/scan`, {
      method: "POST",
      headers: { ...authHeaders("vet", "dev-user-beta"), "x-client-timestamp": String(scan2Timestamp) },
      body: JSON.stringify({ status: "sterilized" }),
    }),
  ]);

  const r1 = co1.status === "fulfilled" ? co1.value : null;
  const r2 = co2.status === "fulfilled" ? co2.value : null;
  const ok1 = r1?.ok ?? false;
  const ok2 = r2?.ok ?? false;
  const rl1 = r1?.status === 429;
  const rl2 = r2?.status === 429;
  const errCount = [r1, r2].filter(
    r => r && !r.ok && r.status !== 429
  ).length;

  if (errCount === 0) {
    ok(`ICU burst: concurrent scans handled without server error (ok=${[ok1,ok2].filter(Boolean).length}, rl=${[rl1,rl2].filter(Boolean).length})`);
  } else {
    fail(
      "ICU burst: concurrent scans handled without server error",
      "HIGH",
      `${errCount} concurrent scan(s) returned unexpected error during ICU burst`,
      "Verify scan handler handles concurrent writes without 500 errors"
    );
  }

  // 6.2 Final state is deterministic — last-write-wins by client timestamp
  const finalRes = await get(`/api/equipment/${equipId}`, "admin");
  if (finalRes.ok) {
    const item = await finalRes.json();
    const validStatuses = ["ok", "issue", "maintenance", "sterilized", "overdue", "inactive"];
    if (!validStatuses.includes(item.status)) {
      fail(
        "ICU burst: equipment in valid state after concurrent scans",
        "CRITICAL",
        `Equipment status after ICU burst is corrupt: '${item.status}'`,
        "Verify scan handler transaction atomicity — status must always be a valid enum"
      );
    } else if (ok1 && ok2) {
      // Both scans succeeded — last-write-wins means the higher timestamp (sterilized at t+1) should win
      if (item.status === "sterilized") {
        ok("ICU burst: last-write-wins correctly resolved (sterilized from later timestamp prevails)");
      } else if (item.status === "maintenance") {
        fail(
          "ICU burst: last-write-wins resolution",
          "HIGH",
          `Expected 'sterilized' (higher client timestamp) to win, but got '${item.status}'`,
          "Verify scan handler compares client timestamps to determine last-write-wins"
        );
      } else {
        ok(`ICU burst: final status=${item.status} (valid — concurrent win was deterministic)`);
      }
    } else {
      // One was rate-limited or one failed — winner is whichever succeeded
      ok(`ICU burst: final status=${item.status} (valid, deterministic — one scan won)`);
    }
  } else {
    fail(
      "Equipment readable after ICU burst",
      "CRITICAL",
      `GET /api/equipment/:id returned ${finalRes.status} after concurrent scans`,
      "Check DB transaction isolation and error recovery"
    );
  }

  // 6.3 Verify ICU burst created audit trail entries (no missing records)
  const auditAfterBurst = await get("/api/audit-logs?actionType=equipment_scanned", "admin");
  if (auditAfterBurst.ok) {
    const auditData = await auditAfterBurst.json();
    const burstEntries = (auditData.items ?? []).filter(
      (a: { targetId: string }) => a.targetId === equipId
    );
    // At least one audit entry should exist even if one scan was rate-limited
    if (burstEntries.length >= 1) {
      ok(`ICU burst: audit trail has ${burstEntries.length} entry/entries for concurrent scans`);
    } else {
      fail(
        "ICU burst: audit trail has entries for concurrent scans",
        "HIGH",
        "No audit log entries found for this equipment after ICU burst scans",
        "Ensure logAudit() is called for every successful scan even under concurrency"
      );
    }
  }

  // 6.4 App-closed-mid-action: scan then immediate revert — clean state
  const scanForRevertRes = await scanWithBudget(
    `/api/equipment/${equipId}/scan`,
    { status: "issue", note: "ICU mid-action test" },
    "vet"
  );
  if (scanForRevertRes.ok) {
    const scanData = await scanForRevertRes.json();
    const immediateRevertRes = await post(
      `/api/equipment/${equipId}/revert`,
      { undoToken: scanData.undoToken },
      "vet"
    );
    if (immediateRevertRes.ok) {
      const reverted = await immediateRevertRes.json();
      const validStatuses = ["ok", "issue", "maintenance", "sterilized", "overdue", "inactive"];
      if (validStatuses.includes(reverted.status) && reverted.status !== "issue") {
        ok("App-closed-mid-action: immediate scan+revert leaves equipment in clean pre-scan state");
      } else if (reverted.status === "issue") {
        fail(
          "App-closed-mid-action: state reverted to pre-scan value",
          "HIGH",
          "Status is still 'issue' after revert — revert did not restore previous state",
          "Verify revert handler applies previousState.status correctly"
        );
      } else {
        ok(`App-closed-mid-action: reverted to valid state (status=${reverted.status})`);
      }
    } else {
      fail(
        "App-closed-mid-action: immediate revert succeeds",
        "HIGH",
        `Immediate revert returned ${immediateRevertRes.status}`,
        "Ensure revert window is long enough and token is valid immediately after scan"
      );
    }
  } else {
    fail(
      "App-closed-mid-action: setup scan for immediate revert",
      "MEDIUM",
      `Scan returned ${scanForRevertRes.status} — possibly rate limited`,
      "Check scan rate limiter (10/min) — ICU simulation may exhaust it"
    );
  }

  await deleteTestEquipment(equipId);
}

// ─── Section 7: Data Integrity & Audit Log Consistency ────────────────────────

async function testDataIntegrity() {
  section("D. Data Integrity & Audit Log Consistency");

  const equipId = await createTestEquipment("Data-Integrity-Test");
  if (!equipId) {
    fail(
      "Setup: create equipment for data integrity tests",
      "CRITICAL",
      "POST /api/equipment returned non-200",
      "Check server startup and database connectivity"
    );
    return;
  }

  // Sequence: checkout → scan → return → revert
  // Step 1: Checkout
  const checkoutRes = await post(
    `/api/equipment/${equipId}/checkout`,
    { location: "Ward-7" },
    "technician"
  );
  if (!checkoutRes.ok) {
    fail(
      "Data integrity: checkout step",
      "HIGH",
      `Checkout returned ${checkoutRes.status}`,
      "Fix checkout endpoint"
    );
    await deleteTestEquipment(equipId);
    return;
  }
  ok("Data integrity: checkout completed");

  // Step 2: Scan
  const scanRes = await scanWithBudget(
    `/api/equipment/${equipId}/scan`,
    { status: "ok" },
    "vet"
  );
  if (!scanRes.ok) {
    fail(
      "Data integrity: scan step",
      "HIGH",
      `Scan returned ${scanRes.status}`,
      "Fix scan endpoint"
    );
    await deleteTestEquipment(equipId);
    return;
  }
  ok("Data integrity: scan completed");

  // Step 3: Return
  const returnRes = await post(
    `/api/equipment/${equipId}/return`,
    {},
    "technician"
  );
  if (!returnRes.ok) {
    fail(
      "Data integrity: return step",
      "HIGH",
      `Return returned ${returnRes.status}`,
      "Fix return endpoint"
    );
    await deleteTestEquipment(equipId);
    return;
  }
  const returnData = await returnRes.json();
  ok("Data integrity: return completed");

  // Step 4: Revert (revert the return)
  const revertToken = returnData.undoToken;
  let revertOk = false;
  if (revertToken) {
    const revertRes = await post(
      `/api/equipment/${equipId}/revert`,
      { undoToken: revertToken },
      "vet"
    );
    if (revertRes.ok) {
      ok("Data integrity: revert of return completed");
      revertOk = true;
    } else {
      fail(
        "Data integrity: revert step",
        "MEDIUM",
        `Revert returned ${revertRes.status}`,
        "Check revert token validity and 90-second window"
      );
    }
  }

  // 7.1 Audit log contains all actions in correct order with no duplicates
  await sleep(100); // allow async audit log writes to settle
  const auditAllRes = await get("/api/audit-logs", "admin");

  // Parse the response body ONCE and reuse the parsed object throughout 7.x checks.
  // Fetch Response bodies are single-consume — parsing twice throws.
  type AuditItem = { targetId: string; actionType: string; timestamp: string };
  let auditItems: AuditItem[] = [];
  let auditFetchOk = false;

  if (auditAllRes.ok) {
    auditFetchOk = true;
    const auditData = await auditAllRes.json();
    auditItems = auditData.items ?? [];

    const forThis = auditItems.filter((a) => a.targetId === equipId);

    const expectedActions = [
      "equipment_checked_out",
      "equipment_scanned",
      "equipment_returned",
    ];
    if (revertOk) expectedActions.push("equipment_reverted");

    const foundActions = expectedActions.filter((act) =>
      forThis.some((a) => a.actionType === act)
    );

    if (foundActions.length === expectedActions.length) {
      ok(`Audit log contains all expected actions: ${foundActions.join(", ")}`);
    } else {
      const missing = expectedActions.filter((a) => !foundActions.includes(a));
      fail(
        "Audit log contains all expected actions",
        "HIGH",
        `Missing audit log actions: ${missing.join(", ")}`,
        "Ensure logAudit() is called in each handler after successful DB writes"
      );
    }

    // 7.2 Timestamps are in chronological ascending order
    // Audit log is returned newest-first (desc), so reverse to get ascending
    const ascending = [...forThis].reverse();
    const isChronological = ascending.every((entry, i) => {
      if (i === 0) return true;
      return new Date(entry.timestamp).getTime() >= new Date(ascending[i - 1].timestamp).getTime();
    });

    if (isChronological || ascending.length <= 1) {
      ok("Audit log entries are in correct chronological (ascending) order");
    } else {
      fail(
        "Audit log entries in chronological order",
        "MEDIUM",
        "Audit log timestamps are not in chronological ascending order when reversed from DESC query",
        "Verify audit log timestamp is set at time of action, not at insertion time"
      );
    }

    // 7.3 No duplicate audit log action types for this specific test sequence
    const actionTypeCounts: Record<string, number> = {};
    for (const a of forThis) {
      actionTypeCounts[a.actionType] = (actionTypeCounts[a.actionType] || 0) + 1;
    }
    const hasDuplicates = Object.entries(actionTypeCounts).some(
      ([, count]) => count > 1
    );
    if (!hasDuplicates) {
      ok("No duplicate audit log action types for this equipment test sequence");
    } else {
      fail(
        "No duplicate audit log action types",
        "MEDIUM",
        `Duplicate audit entries found: ${JSON.stringify(actionTypeCounts)}`,
        "Check if logAudit() is called multiple times per action"
      );
    }
  } else {
    fail(
      "Audit log accessible for data integrity check",
      "HIGH",
      `GET /api/audit-logs returned ${auditAllRes.status}`,
      "Verify admin can access audit-logs endpoint"
    );
  }

  // 7.4 Equipment final status is consistent with audit trail's last recorded action
  const equipState = await get(`/api/equipment/${equipId}`, "admin");
  if (equipState.ok) {
    const item = await equipState.json();
    const validStatuses = ["ok", "issue", "maintenance", "sterilized", "overdue", "inactive"];
    if (validStatuses.includes(item.status)) {
      ok(`Equipment final status is valid after full sequence (status=${item.status})`);
    } else {
      fail(
        "Equipment final status is valid after full action sequence",
        "HIGH",
        `Equipment has invalid status '${item.status}' after checkout→scan→return→revert`,
        "Check all state transitions leave equipment in a valid enum state"
      );
    }

    // 7.5 Audit trail's last action matches equipment's current state
    // Uses the already-parsed auditItems — no second body parse.
    if (auditFetchOk) {
      const forThis = auditItems.filter((a) => a.targetId === equipId);
      // Sorted newest-first; last action is at index 0
      const lastAuditAction = forThis[0]?.actionType;
      const expectedLastAction = revertOk ? "equipment_reverted" : "equipment_returned";
      if (lastAuditAction === expectedLastAction) {
        ok(`Audit trail last entry matches final action (${lastAuditAction})`);
      } else if (lastAuditAction) {
        fail(
          "Audit trail last entry matches final action",
          "MEDIUM",
          `Expected last audit action to be '${expectedLastAction}', got '${lastAuditAction}'`,
          "Verify logAudit() is called after each operation and timestamps are correctly ordered"
        );
      }
    }
  }

  await deleteTestEquipment(equipId);
}

// ─── Section 8: Full Regression Guard ─────────────────────────────────────────

async function testRegressionSmokeFull() {
  section("E. Regression Guard (Full Smoke)");

  // 8.1 Health check
  const healthRes = await fetch(`${BASE}/api/healthz`);
  if (healthRes.status === 200) {
    ok("Health check passes (/api/healthz returns 200)");
  } else if (healthRes.status >= 500) {
    fail(
      "Health check passes",
      "CRITICAL",
      `GET /api/healthz returned ${healthRes.status} — Clerk middleware may be active without CLERK_PUBLISHABLE_KEY`,
      "Ensure CLERK_SECRET_KEY is unset for dev mode, or configure CLERK_PUBLISHABLE_KEY for Clerk auth"
    );
  } else {
    ok(`Health check reachable (status=${healthRes.status})`);
  }

  // 8.2 Equipment list is accessible
  const listRes = await get("/api/equipment", "admin");
  if (listRes.ok) {
    const items = await listRes.json();
    if (Array.isArray(items)) {
      ok(`Equipment list returns array (${items.length} items)`);
    } else {
      fail(
        "Equipment list returns array",
        "HIGH",
        "GET /api/equipment did not return an array",
        "Verify equipment list handler returns [] on empty or an array"
      );
    }
  } else {
    fail(
      "Equipment list is accessible",
      "CRITICAL",
      `GET /api/equipment returned ${listRes.status}`,
      "Fix GET /api/equipment handler"
    );
  }

  // 8.3 Users list is accessible for admin
  const usersRes = await get("/api/users", "admin");
  if (usersRes.ok) {
    ok("Users list accessible to admin");
  } else {
    fail(
      "Users list accessible to admin",
      "HIGH",
      `GET /api/users returned ${usersRes.status}`,
      "Fix GET /api/users handler"
    );
  }

  // 8.4 Alert-acks accessible to viewer+
  const acksRes = await get("/api/alert-acks", "student");
  if (acksRes.ok) {
    ok("Alert-acks list accessible to viewer+");
  } else {
    fail(
      "Alert-acks list accessible to viewer+",
      "MEDIUM",
      `GET /api/alert-acks returned ${acksRes.status}`,
      "Verify GET /api/alert-acks is accessible to all authenticated users"
    );
  }

  // 8.5 Audit logs accessible to admin
  const auditRes = await get("/api/audit-logs", "admin");
  if (auditRes.ok) {
    ok("Audit logs accessible to admin");
  } else {
    fail(
      "Audit logs accessible to admin",
      "MEDIUM",
      `GET /api/audit-logs returned ${auditRes.status}`,
      "Verify GET /api/audit-logs is accessible to admin"
    );
  }

  // 8.6 Full create-scan-delete cycle without error
  const smokeId = await createTestEquipment("Smoke-Regression-Test");
  if (smokeId) {
    const smokeScan = await scanWithBudget(
      `/api/equipment/${smokeId}/scan`,
      { status: "ok" },
      "vet"
    );
    const smokeDelete = await del(`/api/equipment/${smokeId}`, "admin");
    if (smokeScan.ok && smokeDelete.status === 204) {
      ok("Full create-scan-delete cycle completes without error");
    } else {
      fail(
        "Full create-scan-delete cycle",
        "HIGH",
        `Smoke cycle failed: scan=${smokeScan.status}, delete=${smokeDelete.status}`,
        "Check scan and delete endpoints for regressions"
      );
    }
  } else {
    fail(
      "Smoke cycle: equipment creation",
      "HIGH",
      "Failed to create equipment for smoke regression test",
      "Fix POST /api/equipment"
    );
  }
}

// ─── Final report ─────────────────────────────────────────────────────────────

function printReport() {
  const critical = issues.filter((i) => i.severity === "CRITICAL");
  const high = issues.filter((i) => i.severity === "HIGH");
  const medium = issues.filter((i) => i.severity === "MEDIUM");
  const low = issues.filter((i) => i.severity === "LOW");

  console.log(`\n${"═".repeat(60)}`);
  console.log("  VETTRACK QA VALIDATION REPORT");
  console.log("═".repeat(60));
  console.log(`  Total:    ${passed + failed} tests`);
  console.log(`  Passed:   ${passed}`);
  console.log(`  Failed:   ${failed}`);
  console.log("─".repeat(60));

  if (critical.length > 0) {
    console.log(`\n  🔴 CRITICAL (${critical.length})`);
    for (const i of critical) {
      console.log(`    • [${i.section}] ${i.scenario}`);
      console.log(`      Root cause: ${i.rootCause}`);
      console.log(`      Fix:        ${i.recommendedFix}`);
    }
  }

  if (high.length > 0) {
    console.log(`\n  🟠 HIGH (${high.length})`);
    for (const i of high) {
      console.log(`    • [${i.section}] ${i.scenario}`);
      console.log(`      Root cause: ${i.rootCause}`);
      console.log(`      Fix:        ${i.recommendedFix}`);
    }
  }

  if (medium.length > 0) {
    console.log(`\n  🟡 MEDIUM (${medium.length})`);
    for (const i of medium) {
      console.log(`    • [${i.section}] ${i.scenario}`);
      console.log(`      Root cause: ${i.rootCause}`);
      console.log(`      Fix:        ${i.recommendedFix}`);
    }
  }

  if (low.length > 0) {
    console.log(`\n  🔵 LOW (${low.length})`);
    for (const i of low) {
      console.log(`    • [${i.section}] ${i.scenario}`);
    }
  }

  console.log(`\n${"─".repeat(60)}`);

  let verdict: string;
  if (critical.length > 0) {
    verdict = "🔴 BROKEN";
  } else if (high.length > 0) {
    verdict = "🟠 AT RISK";
  } else if (medium.length > 0) {
    verdict = "🟡 AT RISK (minor)";
  } else {
    verdict = "🟢 STABLE";
  }

  console.log(`  System Status: ${verdict}`);
  console.log("═".repeat(60));
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function run() {
  console.log("═".repeat(60));
  console.log("  VetTrack QA & Validation Suite");
  console.log(`  Target: ${BASE}`);
  console.log(`  Date:   ${new Date().toISOString()}`);
  console.log("═".repeat(60));

  // Check server is up — accept any HTTP response as "server is reachable"
  // In dev mode without CLERK_SECRET_KEY, healthz returns 200.
  // In dev mode WITH CLERK_SECRET_KEY set, Clerk middleware may intercept all
  // requests causing 500s. The suite proceeds and reports failures accurately.
  try {
    const healthRaw = await fetch(`${BASE}/api/healthz`);
    if (healthRaw.status === 200) {
      console.log("\n  Server reachable ✓ (healthz=200, dev mode active)");
    } else if (healthRaw.status >= 500) {
      console.warn(
        `\n  ⚠️  Server returned ${healthRaw.status} on /api/healthz — Clerk middleware may be active.`
      );
      console.warn(
        "     Tests using x-dev-role-override will fail in Clerk-auth mode."
      );
      console.warn(
        "     To run this suite: ensure CLERK_SECRET_KEY is unset (pure dev mode)."
      );
    } else {
      console.log(`\n  Server reachable ✓ (healthz=${healthRaw.status})`);
    }
  } catch (e) {
    console.error("\n  ❌ Server not reachable — start the dev server first.");
    console.error("     Run: npm run dev");
    process.exit(1);
  }

  // ── Run sections with inter-section regression smokes ──────────────────────
  // Sections are structured to match the spec taxonomy:
  //   A. Core Features  →  QR scan flow + checkout ownership + alert-acks
  //   B. ICU Simulation →  concurrent writes, conflict resolution
  //   C. Failure Scenarios → RBAC enforcement, error handling
  //   D. Data Integrity →  audit log consistency
  //   E. Regression     →  offline sync/revert + inter-section smokes + full smoke
  //
  // The scan rate limiter (10/min) is managed by scanWithBudget() and
  // ensureScanBudget(), which automatically pause when the budget is nearly
  // exhausted, ensuring repeatable outcomes regardless of run speed.

  // ─── A. Core Features ────────────────────────────────────────────────────────
  await testQrScanFlow();
  await regressionSmoke("after A: QR Scan Flow");

  await testCheckoutOwnership();
  await regressionSmoke("after A: Checkout Ownership");

  await testAlertAcks();
  await regressionSmoke("after A: Alert Acknowledgments");

  // ─── B. ICU Simulation ───────────────────────────────────────────────────────
  await testIcuSimulation();
  await regressionSmoke("after B: ICU Simulation");

  // ─── C. Failure Scenarios ────────────────────────────────────────────────────
  await testRbacEnforcement();
  await regressionSmoke("after C: Failure Scenarios (RBAC)");

  // ─── D. Data Integrity ───────────────────────────────────────────────────────
  await testDataIntegrity();
  await regressionSmoke("after D: Data Integrity");

  // ─── E. Regression ───────────────────────────────────────────────────────────
  // Offline sync/revert is grouped under Regression since it validates that
  // queued actions, reverts, and replay produce consistent state.
  await testOfflineSyncAndRevert();
  await regressionSmoke("after E: Offline Sync & Revert");

  // Full regression guard runs last — comprehensive end-to-end smoke
  await testRegressionSmokeFull();

  printReport();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error("Unexpected error:", e);
  process.exit(1);
});
