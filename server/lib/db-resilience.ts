const TRANSIENT_DB_CODES = new Set([
  "57P01", // admin shutdown
  "57P02", // crash shutdown
  "57P03", // cannot connect now
  "53300", // too many connections
  "53400", // configuration limit exceeded
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "08P01",
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
]);

const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.DB_OP_TIMEOUT_MS ?? "8000", 10) || 8000;
const DEFAULT_RETRIES = Number.parseInt(process.env.DB_OP_RETRIES ?? "2", 10) || 2;
const DEFAULT_BASE_DELAY_MS = Number.parseInt(process.env.DB_OP_RETRY_BASE_MS ?? "250", 10) || 250;
const DEFAULT_MAX_DELAY_MS = Number.parseInt(process.env.DB_OP_RETRY_MAX_MS ?? "3000", 10) || 3000;

export function isTransientDbError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; errno?: string; message?: string };
  const code = candidate.code ?? candidate.errno;
  if (code && TRANSIENT_DB_CODES.has(code)) return true;
  const message = String(candidate.message ?? "").toLowerCase();
  return message.includes("connection timeout") || message.includes("connection terminated");
}

export async function withDbTimeout<T>(run: () => Promise<T>, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    run(),
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`DB operation timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

export async function withDbRetry<T>(
  run: () => Promise<T>,
  options?: { retries?: number; baseDelayMs?: number; maxDelayMs?: number }
): Promise<T> {
  const retries = options?.retries ?? DEFAULT_RETRIES;
  const base = options?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const max = options?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !isTransientDbError(error)) throw error;
      const backoff = Math.min(max, base * 2 ** attempt);
      const jitter = Math.round(backoff * (0.5 + Math.random()));
      await new Promise((resolve) => setTimeout(resolve, jitter));
    }
  }

  throw lastError;
}
