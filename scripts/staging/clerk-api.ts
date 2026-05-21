/**
 * Minimal Clerk Backend REST helpers (staging test users only).
 */

export type ClerkUserRecord = {
  id: string;
  email: string;
};

function clerkSecret(): string {
  const secret = (process.env.CLERK_SECRET_KEY ?? "").trim();
  if (!secret.startsWith("sk_test_")) {
    throw new Error("[staging-clerk] sk_test_ CLERK_SECRET_KEY required");
  }
  return secret;
}

async function clerkFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`https://api.clerk.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${clerkSecret()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

export async function findClerkUserByEmail(email: string): Promise<ClerkUserRecord | null> {
  const res = await clerkFetch(
    `/users?email_address=${encodeURIComponent(email)}&limit=1`,
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[staging-clerk] list users failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as Array<{
    id: string;
    email_addresses?: Array<{ email_address: string }>;
  }>;
  const row = data[0];
  if (!row) return null;
  const primary =
    row.email_addresses?.[0]?.email_address ?? email;
  return { id: row.id, email: primary };
}

export async function createClerkStagingUser(params: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}): Promise<ClerkUserRecord> {
  const res = await clerkFetch("/users", {
    method: "POST",
    body: JSON.stringify({
      email_address: [params.email],
      password: params.password,
      first_name: params.firstName,
      last_name: params.lastName,
      skip_password_checks: true,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[staging-clerk] create user failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as {
    id: string;
    email_addresses?: Array<{ email_address: string }>;
  };
  return {
    id: data.id,
    email: data.email_addresses?.[0]?.email_address ?? params.email,
  };
}

export async function deleteClerkUser(userId: string): Promise<void> {
  const res = await clerkFetch(`/users/${userId}`, { method: "DELETE" });
  if (res.status === 404) return;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[staging-clerk] delete user ${userId} failed (${res.status}): ${text}`);
  }
}
