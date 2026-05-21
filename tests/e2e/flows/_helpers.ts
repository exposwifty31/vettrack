import { type APIRequestContext, expect } from "@playwright/test";

export const BASE_URL = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3001";

/** Fail the test if any request finishes with status >= 400 (except expected probes). */
export function attachNetworkFailureGuard(
  page: import("@playwright/test").Page,
  opts?: { allowPaths?: RegExp[] },
): void {
  const allow = opts?.allowPaths ?? [/\/api\/healthz/, /\/api\/users\/me/];
  page.on("response", (res) => {
    const url = res.url();
    if (!url.includes("/api/")) return;
    if (allow.some((re) => re.test(url))) return;
    if (res.status() >= 400) {
      throw new Error(`Unexpected API failure: ${res.status()} ${url}`);
    }
  });
}

export async function apiGet(
  request: APIRequestContext,
  path: string,
  headers?: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  // Use path relative to playwright.config baseURL (TEST_BASE_URL in CI).
  const res = await request.get(path, { headers });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }
  return { status: res.status(), body };
}

export async function apiPost(
  request: APIRequestContext,
  path: string,
  data?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  const res = await request.post(path, {
    headers: { "Content-Type": "application/json", ...headers },
    data: data ?? {},
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }
  return { status: res.status(), body };
}

export async function expectHealthz(request: APIRequestContext): Promise<void> {
  const res = await request.get(`${BASE_URL}/api/healthz`);
  expect(res.status()).toBe(200);
  expect(await res.text()).toBe("ok");
}

/** Dev-bypass role override headers (NODE_ENV=test, no Clerk secret in CI). */
export function devRoleHeaders(role: string, userId = "dev-admin-001"): Record<string, string> {
  return {
    "x-dev-role-override": role,
    "x-dev-user-id-override": userId,
  };
}
