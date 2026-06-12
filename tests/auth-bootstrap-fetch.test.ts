/**
 * Auth bootstrap fetch — regression tests (#379 permanent pending screen).
 *
 * Bootstrap calls must bypass authFetch (empty userId guard + 401 throw) so
 * use-auth can provision users and read /api/users/me before authStore is warm.
 *
 * Static source contracts only — no Clerk or live server.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const apiSrc = fs.readFileSync(path.join(ROOT, "src/lib/api.ts"), "utf8");
const requestCoreSrc = fs.readFileSync(path.join(ROOT, "src/lib/request-core.ts"), "utf8");
const useAuthSrc = fs.readFileSync(path.join(ROOT, "src/hooks/use-auth.tsx"), "utf8");

function sliceBetween(source: string, startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("bootstrapFetchWithTimeout", () => {
  it("is defined and documented as bypassing authFetch", () => {
    expect(apiSrc).toContain("function bootstrapFetchWithTimeout(");
    expect(apiSrc).toContain("bypasses authFetch intentionally");
    expect(apiSrc).toContain("getCurrentUserId()");
  });

  it("uses raw fetch, not authFetch", () => {
    const fnBody = sliceBetween(
      apiSrc,
      "function bootstrapFetchWithTimeout(",
      "export async function authFetchUsersMe",
    );
    expect(fnBody).toContain("fetch(resolveApiUrl(url)");
    expect(fnBody).not.toContain("authFetch(");
  });
});

describe("authFetchUsersMe / authPostUsersSync", () => {
  it("authFetchUsersMe targets /api/users/me via bootstrap fetch", () => {
    const fnBody = sliceBetween(
      apiSrc,
      "export async function authFetchUsersMe",
      "export async function authPostUsersSync",
    );
    expect(fnBody).toContain('"/api/users/me"');
    expect(fnBody).toContain("bootstrapFetchWithTimeout");
    expect(fnBody).not.toContain("authFetch(");
  });

  it("authPostUsersSync targets /api/users/sync via bootstrap fetch", () => {
    const fnBody = sliceBetween(
      apiSrc,
      "export async function authPostUsersSync",
      "/** Success body from POST /api/containers/:id/dispense */",
    );
    expect(fnBody).toContain('"/api/users/sync"');
    expect(fnBody).toContain("bootstrapFetchWithTimeout");
    expect(fnBody).not.toContain("authFetch(");
  });

  it("authenticated request() path still uses authFetch for routine API calls", () => {
    const fetchWithTimeoutBody = sliceBetween(
      requestCoreSrc,
      "export function fetchWithTimeout(",
      "export async function request",
    );
    expect(fetchWithTimeoutBody).toContain("authFetch(url");
  });
});

describe("use-auth session bootstrap wiring", () => {
  it("imports bootstrap helpers from api.ts", () => {
    expect(useAuthSrc).toContain('import { authFetchUsersMe, authPostUsersSync } from "@/lib/api"');
  });

  it("syncSession calls authFetchUsersMe before authPostUsersSync fallback", () => {
    const syncStart = useAuthSrc.indexOf("async function syncSession");
    expect(syncStart).toBeGreaterThan(-1);
    const syncEnd = useAuthSrc.indexOf("\nasync function", syncStart + 1);
    const syncBody = useAuthSrc.slice(syncStart, syncEnd > syncStart ? syncEnd : syncStart + 6000);
    const meIdx = syncBody.indexOf("authFetchUsersMe");
    const postIdx = syncBody.indexOf("authPostUsersSync");
    expect(meIdx).toBeGreaterThan(-1);
    expect(postIdx).toBeGreaterThan(-1);
    expect(meIdx).toBeLessThan(postIdx);
  });
});
