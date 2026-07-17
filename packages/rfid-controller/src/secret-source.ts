/**
 * Module 7 — secret source + hot-swap on rotation.
 *
 * Rotation grace is SERVER-SIDE (R-M1 M1.1c): during a rotation window
 * `getRfidVerificationSecrets` returns `[current, previous]` and the ingest
 * route (rfid.ts) verifies the request signature against each in turn. Because
 * the server owns the overlap, the controller signs with exactly ONE current
 * secret and simply HOT-SWAPS it on rotation — it never dual-signs. The
 * operational rotation procedure is: rotate the server's per-clinic
 * `webhook_secret` (opening the server-side grace), then hot-swap the
 * controller's source; the server grace covers requests in flight across the
 * swap. The rotated-out secret is NOT retained here — the controller never
 * signs with it, and keeping plaintext credential material resident after
 * rotation is an unnecessary exposure. Observability records rotation metadata,
 * never secret material.
 *
 * Secrets are read from env/config, never from argv, and never logged.
 */
export interface SecretSource {
  /** The secret to sign the current batch with. */
  current(): string;
}

export class StaticSecretSource implements SecretSource {
  constructor(private readonly secret: string) {
    if (!secret.trim()) throw new Error("StaticSecretSource: empty secret");
  }

  current(): string {
    return this.secret;
  }
}

export class RotatableSecretSource implements SecretSource {
  private secret: string;

  constructor(initial: string) {
    if (!initial.trim()) throw new Error("RotatableSecretSource: empty initial secret");
    this.secret = initial;
  }

  current(): string {
    return this.secret;
  }

  /** Hot-swap the signing secret. Takes effect on the next `current()` call. */
  rotate(next: string): void {
    if (!next.trim()) throw new Error("RotatableSecretSource.rotate: empty secret");
    if (next === this.secret) return;
    this.secret = next;
  }
}

/** Read a secret from an environment variable — never from process argv. */
export function secretFromEnv(varName: string): string {
  const value = process.env[varName];
  if (!value || !value.trim()) {
    throw new Error(`secretFromEnv: env var ${varName} is missing or empty`);
  }
  return value;
}
