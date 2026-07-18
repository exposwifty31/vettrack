/**
 * Minimal injectable logger. The controller never uses `console.log` (stdout is
 * reserved for the CLI's own machine-readable output); structured events go to
 * stderr as JSON lines. Callers MUST NOT pass secrets in `fields` — nothing in
 * this package logs a `webhook_secret` or signature secret.
 */
export interface Logger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

/** Discards everything — the default so libraries stay quiet unless opted in. */
export const noopLogger: Logger = {
  info() {},
  warn() {},
  error() {},
};

type WriteFn = (chunk: string) => void;

function line(level: string, event: string, fields?: Record<string, unknown>): string {
  const record = { level, event, ts: new Date().toISOString(), ...(fields ?? {}) };
  return `${JSON.stringify(record)}\n`;
}

/** Structured stderr logger (JSON lines). Never writes to stdout. */
export function createStderrLogger(write: WriteFn = (c) => process.stderr.write(c)): Logger {
  return {
    info(event, fields) {
      write(line("info", event, fields));
    },
    warn(event, fields) {
      write(line("warn", event, fields));
    },
    error(event, fields) {
      write(line("error", event, fields));
    },
  };
}
