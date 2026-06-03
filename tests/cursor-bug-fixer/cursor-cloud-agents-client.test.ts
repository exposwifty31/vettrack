import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isCursorApiConfigured } from "../../server/lib/cursor-cloud-agents-client.js";

describe("cursor-cloud-agents-client env", () => {
  let prior: string | undefined;

  beforeEach(() => {
    prior = process.env.CURSOR_API_KEY;
    delete process.env.CURSOR_API_KEY;
  });

  afterEach(() => {
    if (prior === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prior;
  });

  it("isCursorApiConfigured is false without key", () => {
    expect(isCursorApiConfigured()).toBe(false);
  });

  it("isCursorApiConfigured is true with key", () => {
    process.env.CURSOR_API_KEY = "cursor_test";
    expect(isCursorApiConfigured()).toBe(true);
  });
});
