import { describe, it, expect } from "vitest";
import { sanitizeUploadExtension, buildAvatarKey } from "../server/lib/upload-filename.js";

describe("sanitizeUploadExtension", () => {
  it("extracts a lowercase extension from a normal filename", () => {
    expect(sanitizeUploadExtension("photo.PNG")).toBe("png");
    expect(sanitizeUploadExtension("selfie.jpeg")).toBe("jpeg");
  });

  it("strips path-traversal / non-alphanumeric characters", () => {
    expect(sanitizeUploadExtension("evil.jp g/../../etc")).toBe("etc");
    expect(sanitizeUploadExtension("x.p<>ng")).toBe("png");
  });

  it("falls back to jpg when the extension segment sanitizes to empty", () => {
    expect(sanitizeUploadExtension("trailingdot.")).toBe("jpg");
    expect(sanitizeUploadExtension("weird.!@#")).toBe("jpg");
  });

  it("treats a dotless name's whole string as the extension (parity with fault-image)", () => {
    // "noext".split(".").pop() === "noext" — matches the existing route's behavior.
    expect(sanitizeUploadExtension("noext")).toBe("noext");
  });

  it("caps the extension length at 10 characters", () => {
    expect(sanitizeUploadExtension("file.abcdefghijklmnop")).toBe("abcdefghij");
  });
});

describe("buildAvatarKey", () => {
  it("namespaces the key under avatars/ with the user id and sanitized ext", () => {
    const key = buildAvatarKey("user-123", "me.PNG");
    expect(key).toMatch(/^avatars\/user-123-[0-9a-f-]{36}\.png$/);
  });

  it("produces a distinct key on each call (uuid)", () => {
    const a = buildAvatarKey("u", "a.jpg");
    const b = buildAvatarKey("u", "a.jpg");
    expect(a).not.toBe(b);
  });
});
