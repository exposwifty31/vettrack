/**
 * Auth clinic bootstrap — static-analysis tests.
 *
 * Verifies that resolveAuthUser guarantees a vt_clinics row exists before
 * upserting vt_users, preventing the vt_users_clinic_id_fk FK violation that
 * occurred when a Clerk org had no corresponding vt_clinics row.
 *
 * Tests are source-text assertions so they run without a live DB.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const authSrc = fs.readFileSync(path.join(ROOT, "server/middleware/auth.ts"), "utf8");

// ---------------------------------------------------------------------------
// 1. ensureClinicExistsForOrg is defined
// ---------------------------------------------------------------------------
describe("ensureClinicExistsForOrg — definition", () => {
  it("function is defined in auth.ts", () => {
    expect(authSrc).toContain("async function ensureClinicExistsForOrg(");
  });

  it("uses onConflictDoNothing for idempotent insert", () => {
    const fnStart = authSrc.indexOf("async function ensureClinicExistsForOrg(");
    const fnEnd = authSrc.indexOf("\n}", fnStart);
    const fnBody = authSrc.slice(fnStart, fnEnd + 2);
    expect(fnBody).toContain("onConflictDoNothing");
  });

  it("inserts into clinics table with the clerkOrgId as the id", () => {
    const fnStart = authSrc.indexOf("async function ensureClinicExistsForOrg(");
    const fnEnd = authSrc.indexOf("\n}", fnStart);
    const fnBody = authSrc.slice(fnStart, fnEnd + 2);
    expect(fnBody).toContain(".insert(clinics)");
    expect(fnBody).toContain("id: clerkOrgId");
  });

  it("does not insert any other columns (minimal safe insert)", () => {
    const fnStart = authSrc.indexOf("async function ensureClinicExistsForOrg(");
    const fnEnd = authSrc.indexOf("\n}", fnStart);
    const fnBody = authSrc.slice(fnStart, fnEnd + 2);
    // The values object should only contain id; no extra columns that could
    // fail if the schema gains a new required field.
    const valuesMatch = fnBody.match(/\.values\(\{([^}]+)\}/);
    expect(valuesMatch, "values() call not found in ensureClinicExistsForOrg").not.toBeNull();
    const valuesBody = valuesMatch![1].trim();
    expect(valuesBody).toBe("id: clerkOrgId");
  });
});

// ---------------------------------------------------------------------------
// 2. Call order in resolveAuthUser: clinic first, then user insert
// ---------------------------------------------------------------------------
describe("resolveAuthUser — clinic-before-user call order", () => {
  it("calls ensureClinicExistsForOrg before the user insert", () => {
    const fnStart = authSrc.indexOf("export async function resolveAuthUser(");
    expect(fnStart).toBeGreaterThan(-1);
    const fnEnd = authSrc.indexOf("\nexport ", fnStart + 1);
    const fnBody = authSrc.slice(fnStart, fnEnd);

    const clinicCallIdx = fnBody.indexOf("await ensureClinicExistsForOrg(");
    const userInsertIdx = fnBody.indexOf(".insert(users)");

    expect(clinicCallIdx, "ensureClinicExistsForOrg call not found in resolveAuthUser").toBeGreaterThan(-1);
    expect(userInsertIdx, ".insert(users) call not found in resolveAuthUser").toBeGreaterThan(-1);
    expect(clinicCallIdx).toBeLessThan(userInsertIdx);
  });

  it("passes clerkOrgId to ensureClinicExistsForOrg", () => {
    expect(authSrc).toContain("await ensureClinicExistsForOrg(clerkOrgId)");
  });
});

// ---------------------------------------------------------------------------
// 3. FK constraint is preserved (not removed or bypassed)
// ---------------------------------------------------------------------------
describe("FK constraint preservation", () => {
  it("vt_users.clinic_id FK is still declared in db.ts", () => {
    const dbSrc = fs.readFileSync(path.join(ROOT, "server/db.ts"), "utf8");
    // The users table clinic_id column must still reference clinics.id
    const usersTableStart = dbSrc.indexOf('export const users = pgTable("vt_users"');
    const usersTableEnd = dbSrc.indexOf("\n});", usersTableStart);
    const usersBody = dbSrc.slice(usersTableStart, usersTableEnd);
    expect(usersBody).toContain("clinicId");
    expect(usersBody).toContain(".references(");
    expect(usersBody).toContain("clinics.id");
  });
});

// ---------------------------------------------------------------------------
// 4. Dev bypass path also ensures clinic first (regression guard)
// ---------------------------------------------------------------------------
describe("ensureDevUserRecord — existing clinic-first pattern", () => {
  it("ensureDevUserRecord still inserts clinics before users", () => {
    const fnStart = authSrc.indexOf("async function ensureDevUserRecord(");
    const fnEnd = authSrc.indexOf("\n}", fnStart);
    const fnBody = authSrc.slice(fnStart, fnEnd + 2);

    const clinicInsertIdx = fnBody.indexOf(".insert(clinics)");
    const userInsertIdx = fnBody.indexOf(".insert(users)");

    expect(clinicInsertIdx).toBeGreaterThan(-1);
    expect(userInsertIdx).toBeGreaterThan(-1);
    expect(clinicInsertIdx).toBeLessThan(userInsertIdx);
  });

  it("ensureDevUserRecord uses onConflictDoNothing for clinic", () => {
    const fnStart = authSrc.indexOf("async function ensureDevUserRecord(");
    const firstConflictIdx = authSrc.indexOf("onConflictDoNothing", fnStart);
    const insertUsersIdx = authSrc.indexOf(".insert(users)", fnStart);
    // onConflictDoNothing must appear before .insert(users) within the function
    expect(firstConflictIdx).toBeLessThan(insertUsersIdx);
  });
});

// ---------------------------------------------------------------------------
// 5. sessionContextMiddleware does not swallow FK errors silently
// ---------------------------------------------------------------------------
describe("sessionContextMiddleware — error logging", () => {
  it("logs errors from resolveAuthUser rather than discarding them", () => {
    const mwStart = authSrc.indexOf("export async function sessionContextMiddleware(");
    const mwEnd = authSrc.indexOf("\nexport ", mwStart + 1);
    const mwBody = authSrc.slice(mwStart, mwEnd);
    // catch block must call console.error
    expect(mwBody).toContain("console.error(");
  });
});
