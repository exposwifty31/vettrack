/**
 * Connection-string resolution for PgBouncer support.
 *
 * The runtime pool should prefer PGBOUNCER_URL (Railway's pooled endpoint) when
 * set; migrations must use a DIRECT connection (getDirectPostgresqlConnectionString)
 * because migrate.ts holds a session-level pg_advisory_lock, which breaks under
 * PgBouncer transaction pooling (acquire/release can land on different backends).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  getPostgresqlConnectionString,
  getDirectPostgresqlConnectionString,
  isPostgresqlConfigured,
} from "../server/lib/postgresql.js";

const KEYS = ["PGBOUNCER_URL", "POSTGRES_URL", "DATABASE_URL"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("getPostgresqlConnectionString — PGBOUNCER_URL precedence (runtime pool)", () => {
  it("prefers PGBOUNCER_URL over POSTGRES_URL and DATABASE_URL", () => {
    process.env.PGBOUNCER_URL = "postgres://pooled/db";
    process.env.POSTGRES_URL = "postgres://direct/db";
    process.env.DATABASE_URL = "postgres://direct/db"; // same → does not trip the pg/db guard
    expect(getPostgresqlConnectionString()).toBe("postgres://pooled/db");
  });

  it("falls back to POSTGRES_URL || DATABASE_URL when PGBOUNCER_URL is unset", () => {
    process.env.DATABASE_URL = "postgres://direct/db";
    expect(getPostgresqlConnectionString()).toBe("postgres://direct/db");
  });

  it("uses PGBOUNCER_URL even though it differs from DATABASE_URL (that's expected, not the unsafe guard)", () => {
    process.env.PGBOUNCER_URL = "postgres://pooled/db";
    process.env.DATABASE_URL = "postgres://direct/db";
    expect(() => getPostgresqlConnectionString()).not.toThrow();
    expect(getPostgresqlConnectionString()).toBe("postgres://pooled/db");
  });

  it("still throws when POSTGRES_URL and DATABASE_URL disagree (guard unchanged)", () => {
    process.env.POSTGRES_URL = "postgres://a/db";
    process.env.DATABASE_URL = "postgres://b/db";
    expect(() => getPostgresqlConnectionString()).toThrow(/unsafe/i);
  });

  it("still throws on a POSTGRES_URL/DATABASE_URL mismatch even when PGBOUNCER_URL is set (mismatch is a real misconfig — migrations read those two directly)", () => {
    process.env.PGBOUNCER_URL = "postgres://pooled/db";
    process.env.POSTGRES_URL = "postgres://a/db";
    process.env.DATABASE_URL = "postgres://b/db";
    expect(() => getPostgresqlConnectionString()).toThrow(/unsafe/i);
  });

  it("throws when nothing is configured", () => {
    expect(() => getPostgresqlConnectionString()).toThrow(/not set/i);
  });
});

describe("getDirectPostgresqlConnectionString — always bypasses PgBouncer (migrations)", () => {
  it("ignores PGBOUNCER_URL and returns POSTGRES_URL || DATABASE_URL", () => {
    process.env.PGBOUNCER_URL = "postgres://pooled/db";
    process.env.DATABASE_URL = "postgres://direct/db";
    expect(getDirectPostgresqlConnectionString()).toBe("postgres://direct/db");
  });

  it("throws when neither POSTGRES_URL nor DATABASE_URL is set (even if PGBOUNCER_URL is)", () => {
    process.env.PGBOUNCER_URL = "postgres://pooled/db";
    expect(() => getDirectPostgresqlConnectionString()).toThrow(/not set/i);
  });
});

describe("migrate.ts runs on a DIRECT (non-PgBouncer) connection", () => {
  // migrate.ts holds a session-level pg_advisory_lock, which breaks under
  // PgBouncer transaction pooling — so migrations must never route through the
  // pooled runtime pool.
  const src = readFileSync(resolve(process.cwd(), "server/migrate.ts"), "utf-8");

  it("builds its pool from getDirectPostgresqlConnectionString", () => {
    expect(src).toMatch(/getDirectPostgresqlConnectionString/);
  });

  it("does not import the shared (PgBouncer-routed) pool from ./db.js", () => {
    expect(src).not.toMatch(/from\s+["']\.\/db\.js["']/);
  });
});

describe("isPostgresqlConfigured", () => {
  it("counts PGBOUNCER_URL as configured", () => {
    process.env.PGBOUNCER_URL = "postgres://pooled/db";
    expect(isPostgresqlConfigured()).toBe(true);
  });
  it("false when nothing is set", () => {
    expect(isPostgresqlConfigured()).toBe(false);
  });
});
