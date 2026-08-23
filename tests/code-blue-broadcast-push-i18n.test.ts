/**
 * Code Blue clinic-wide activation push — i18n extraction.
 *
 * The two initiation handlers must not hardcode Hebrew in the
 * `code_blue_broadcast` notification payload. Copy lives under
 * `push.codeBlue.*` and is rendered via `translate` + `getLocaleDictionaries`
 * (Hebrew product default for clinic-wide broadcast).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import enDict from "../locales/en.json";
import heDict from "../locales/he.json";

const HEBREW_RE = /[֐-׿]/;

const HANDLERS = [
  "server/routes/code-blue/handlers/post-sessions.ts",
  "server/routes/code-blue/handlers/post-one-tap.ts",
] as const;

const HELPER = "server/lib/code-blue-broadcast-push.ts";

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf-8");
}

describe("push.codeBlue locale keys (parity + clinical wording)", () => {
  it("Hebrew title and body match today's clinic-known wording", () => {
    const push = (heDict as { push: { codeBlue?: { title?: string; body?: string } } }).push;
    expect(push.codeBlue?.title).toBe("⚠ CODE BLUE");
    expect(push.codeBlue?.body).toBe("CODE BLUE הופעל ע״י {name}");
  });

  it("English body keeps CODE BLUE clinical term and interpolates {name}", () => {
    const push = (enDict as { push: { codeBlue?: { title?: string; body?: string } } }).push;
    expect(push.codeBlue?.title).toBe("⚠ CODE BLUE");
    expect(push.codeBlue?.body).toBe("CODE BLUE activated by {name}");
  });
});

describe("resolveCodeBlueBroadcastPushCopy", () => {
  it("renders Hebrew default body with the actor name interpolated", async () => {
    const { resolveCodeBlueBroadcastPushCopy } = await import(
      "../server/lib/code-blue-broadcast-push.js"
    );
    const copy = resolveCodeBlueBroadcastPushCopy('ד"ר כהן');
    expect(copy.title).toBe("⚠ CODE BLUE");
    expect(copy.body).toBe('CODE BLUE הופעל ע״י ד"ר כהן');
    expect(copy.title.length).toBeGreaterThan(0);
    expect(copy.body.length).toBeGreaterThan(0);
  });

  it("fail-opens with ASCII fallback when i18n throws (never skips the push)", async () => {
    const { resolveCodeBlueBroadcastPushCopy, __setCodeBlueBroadcastPushI18nForTests } =
      await import("../server/lib/code-blue-broadcast-push.js");
    __setCodeBlueBroadcastPushI18nForTests(() => {
      throw new Error("locale load failed");
    });
    try {
      const copy = resolveCodeBlueBroadcastPushCopy("Alex");
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.body.length).toBeGreaterThan(0);
      expect(copy.body).toContain("Alex");
      expect(HEBREW_RE.test(copy.title + copy.body)).toBe(false);
    } finally {
      __setCodeBlueBroadcastPushI18nForTests(null);
    }
  });

  it("helper uses INITIAL_LOCALE (he) and push.codeBlue.* keys via translate", () => {
    const src = read(HELPER);
    expect(src).toMatch(/getLocaleDictionaries/);
    expect(src).toMatch(/translate/);
    expect(src).toMatch(/INITIAL_LOCALE/);
    expect(src).toMatch(/push\.codeBlue\.title/);
    expect(src).toMatch(/push\.codeBlue\.body/);
    expect(src).toMatch(/try\s*\{/);
    expect(src).toMatch(/catch/);
    expect(HEBREW_RE.test(src)).toBe(false);
  });
});

describe("Code Blue initiation handlers — no Hebrew glyphs; push still enqueues", () => {
  for (const rel of HANDLERS) {
    it(`${rel} contains no Hebrew glyphs`, () => {
      expect(HEBREW_RE.test(read(rel))).toBe(false);
    });

    it(`${rel} resolves push copy via resolveCodeBlueBroadcastPushCopy and enqueues code_blue_broadcast`, () => {
      const src = read(rel);
      expect(src).toMatch(/resolveCodeBlueBroadcastPushCopy/);
      expect(src).toMatch(/enqueueNotificationJob/);
      expect(src).toMatch(/type:\s*["']code_blue_broadcast["']/);
      expect(src).toMatch(/\.catch\(\s*\(\)\s*=>/);
    });
  }

  it("post-sessions tags the job as code-blue-${id}", () => {
    const src = read(HANDLERS[0]);
    expect(src).toMatch(/tag:\s*`code-blue-\$\{id\}`/);
  });

  it("post-one-tap tags the job as code-blue-${outcome.sessionId}", () => {
    const src = read(HANDLERS[1]);
    expect(src).toMatch(/tag:\s*`code-blue-\$\{outcome\.sessionId\}`/);
  });
});

describe("KNOWN_DEBT_ALLOWLIST no longer lists the extracted handlers", () => {
  it("drops post-sessions.ts and post-one-tap.ts from the Hebrew-in-source allowlist", () => {
    const allowlistSrc = read("tests/i18n-no-hebrew-in-source.test.ts");
    expect(allowlistSrc).not.toContain(
      '"server/routes/code-blue/handlers/post-one-tap.ts"',
    );
    expect(allowlistSrc).not.toContain(
      '"server/routes/code-blue/handlers/post-sessions.ts"',
    );
  });
});
