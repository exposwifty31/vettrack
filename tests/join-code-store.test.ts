/**
 * Invite-link carry store — the `?clinic=CODE` parameter must survive Clerk's
 * OAuth-redirect dance via sessionStorage, and junk must never be persisted or
 * clobber a previously carried valid code.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  captureJoinCodeFromSearch,
  readCarriedJoinCode,
  writeCarriedJoinCode,
} from "../src/features/auth/join-code-store.js";

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("captureJoinCodeFromSearch — /signin?clinic= and /signup?clinic= entry", () => {
  it("stores a valid clinic query value", () => {
    captureJoinCodeFromSearch("?clinic=ABCD23EFGH");
    expect(readCarriedJoinCode()).toBe("ABCD23EFGH");
  });

  it("trims surrounding whitespace before validating", () => {
    captureJoinCodeFromSearch("?clinic=%20ABCD23EFGH%20");
    expect(readCarriedJoinCode()).toBe("ABCD23EFGH");
  });

  it("normalizes a lowercase code to the canonical uppercase form", () => {
    captureJoinCodeFromSearch("?clinic=abcd23efgh");
    expect(readCarriedJoinCode()).toBe("ABCD23EFGH");
  });

  it("ignores a malformed code (too short / bad chars) — nothing persisted", () => {
    captureJoinCodeFromSearch("?clinic=nope");
    expect(readCarriedJoinCode()).toBeNull();
    captureJoinCodeFromSearch("?clinic=BAD-CHARS!!");
    expect(readCarriedJoinCode()).toBeNull();
  });

  it("a junk parameter does not clobber a previously carried valid code", () => {
    captureJoinCodeFromSearch("?clinic=ABCD23EFGH");
    captureJoinCodeFromSearch("?clinic=x");
    expect(readCarriedJoinCode()).toBe("ABCD23EFGH");
  });

  it("no clinic parameter → no write", () => {
    captureJoinCodeFromSearch("?other=1");
    expect(readCarriedJoinCode()).toBeNull();
  });
});

describe("read/write round-trip", () => {
  it("write(null) clears the store", () => {
    writeCarriedJoinCode("ABCD23EFGH");
    writeCarriedJoinCode(null);
    expect(readCarriedJoinCode()).toBeNull();
  });

  it("a corrupted stored value is rejected on read", () => {
    storage.set("vt_clinic_join_code", "<script>");
    expect(readCarriedJoinCode()).toBeNull();
  });
});
