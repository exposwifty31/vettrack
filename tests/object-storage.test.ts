import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { presignObjectUrl } from "../server/lib/object-storage.js";

const S3_ENV = {
  S3_BUCKET: "vettrack-uploads-testhash",
  S3_ACCESS_KEY_ID: "test-access-key",
  S3_SECRET_ACCESS_KEY: "test-secret-key",
  S3_REGION: "auto",
  S3_ENDPOINT: "https://storage.railway.app",
} as const;

describe("presignObjectUrl", () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of Object.keys(S3_ENV)) {
      original[key] = process.env[key];
      process.env[key] = S3_ENV[key as keyof typeof S3_ENV];
    }
  });

  afterEach(() => {
    for (const key of Object.keys(S3_ENV)) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  it("presigns a stored object key into a signed GET URL", async () => {
    const url = await presignObjectUrl("avatars/user-1-abc.jpg");
    expect(url).toBeTruthy();
    expect(url).toContain("storage.railway.app");
    expect(url).toContain("avatars/user-1-abc.jpg");
    expect(url).toContain("X-Amz-Signature=");
    expect(url).toContain("X-Amz-Expires=3600");
  });

  it("returns absolute URLs unchanged (legacy public-URL rows)", async () => {
    const legacy = "https://cdn.example.com/avatars/old.png";
    expect(await presignObjectUrl(legacy)).toBe(legacy);
  });

  it("returns null for null / empty input", async () => {
    expect(await presignObjectUrl(null)).toBeNull();
    expect(await presignObjectUrl(undefined)).toBeNull();
    expect(await presignObjectUrl("")).toBeNull();
  });

  it("returns null for a key when storage is not configured", async () => {
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
    expect(await presignObjectUrl("avatars/user-1.jpg")).toBeNull();
  });
});
