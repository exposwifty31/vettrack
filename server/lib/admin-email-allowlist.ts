let cachedAdminEmailsRaw: string | undefined;
let cachedAdminEmails: string[] | null = null;

export function parseAdminEmailsFromEnv(): string[] {
  const raw = process.env.ADMIN_EMAILS ?? "";
  if (cachedAdminEmails !== null && cachedAdminEmailsRaw === raw) {
    return cachedAdminEmails;
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of raw.split(",")) {
    const normalized = part.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  cachedAdminEmailsRaw = raw;
  cachedAdminEmails = result;
  return result;
}

export function isAdminEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  return parseAdminEmailsFromEnv().includes(normalized);
}

/** Test-only: clears parse cache when env is mutated between cases. */
export function __resetAdminEmailAllowlistCacheForTests(): void {
  cachedAdminEmailsRaw = undefined;
  cachedAdminEmails = null;
}
