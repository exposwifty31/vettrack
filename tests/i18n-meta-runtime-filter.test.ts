import { describe, it, expect } from "vitest";
import { stripInternalKeys, t } from "../src/lib/i18n";

/**
 * `_meta.*` runtime-filter governance test (Phase 6 §5 invariant 13 point (a)).
 *
 * `_meta` is a reserved non-rendering metadata namespace included for
 * parity between `en.json` and `he.json` but NEVER exposed via the runtime
 * `t` accessor tree. This test locks in that invariant for the client
 * builder (`src/lib/i18n.ts::buildTranslations`).
 *
 * Server-side enforcement points (apiError, tPush, WhatsApp helper) land
 * in PR 6.3 and PR 6.11/6.12 with their own dedicated tests.
 */

describe("_meta runtime filter — client accessor tree", () => {
  it("t._meta is undefined at runtime", () => {
    expect((t as Record<string, unknown>)._meta).toBeUndefined();
  });

  it("t has no top-level keys starting with an underscore", () => {
    const offenders = Object.keys(t).filter((k) => k.startsWith("_"));
    expect(offenders).toEqual([]);
  });

  it("stripInternalKeys removes _-prefixed top-level keys", () => {
    const input = { foo: 1, _meta: { bar: 2 }, _other: "x", normal: "kept" };
    const result = stripInternalKeys(input);
    expect(result).toEqual({ foo: 1, normal: "kept" });
  });

  it("stripInternalKeys leaves nested _-keys alone (only top-level filtered)", () => {
    const input = { outer: { _nested: "stays", normal: "stays" } };
    const result = stripInternalKeys(input);
    expect(result).toEqual({ outer: { _nested: "stays", normal: "stays" } });
  });

  it("stripInternalKeys returns a new object (does not mutate input)", () => {
    const input = { keep: 1, _meta: "remove" };
    const result = stripInternalKeys(input);
    expect("_meta" in input).toBe(true);
    expect("_meta" in result).toBe(false);
  });
});
