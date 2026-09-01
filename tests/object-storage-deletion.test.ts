/**
 * `deleteStoredObject` — the difference between deleting a pointer and deleting data.
 *
 * Account deletion used to set `avatarUrl: null` and stop. The bucket is private,
 * so the uploaded image became unreachable and STAYED: no key, no presign, no way
 * to read it — and no deletion either. Unreachable is not erased, and the Play
 * Data safety form asks about the second one (review finding on #203).
 *
 * Two properties matter more than the happy path, and both are asserted here:
 *
 *   - It NEVER THROWS. The caller is a user exercising their Guideline 5.1.1(v)
 *     right to delete their account. If a bucket outage could throw, an outage
 *     could refuse that right — so a failure is an outcome, not an exception.
 *   - It does not touch objects it does not own. A legacy row holding an absolute
 *     URL predates key storage and points somewhere this bucket does not control;
 *     sending a DeleteObjectCommand for it would be a delete against a key made
 *     out of a URL.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const send = vi.fn();
vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  return {
    ...actual,
    S3Client: class {
      send = send;
    },
  };
});

const { deleteStoredObject } = await import("../server/lib/object-storage.js");

const ENV_KEYS = ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const;
const saved: Record<string, string | undefined> = {};

const configure = () => {
  process.env.S3_BUCKET = "vettrack-test";
  process.env.S3_ACCESS_KEY_ID = "key";
  process.env.S3_SECRET_ACCESS_KEY = "secret";
};

beforeEach(() => {
  send.mockReset();
  send.mockResolvedValue({});
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("deleteStoredObject", () => {
  it("deletes the object under the stored key", async () => {
    configure();
    await expect(deleteStoredObject("avatars/u1/abc.png")).resolves.toBe("deleted");
    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0] as { input: { Bucket?: string; Key?: string } };
    expect(command.input).toMatchObject({ Bucket: "vettrack-test", Key: "avatars/u1/abc.png" });
  });

  it.each([
    ["nothing stored", null],
    ["an empty string", ""],
    ["a legacy absolute URL this bucket does not own", "https://cdn.example/u1.png"],
  ])("skips %s without calling storage", async (_label, value) => {
    configure();
    await expect(deleteStoredObject(value)).resolves.toBe("skipped");
    expect(send).not.toHaveBeenCalled();
  });

  it("skips when storage is not configured in this environment", async () => {
    for (const k of ENV_KEYS) delete process.env[k];
    await expect(deleteStoredObject("avatars/u1/abc.png")).resolves.toBe("skipped");
    expect(send).not.toHaveBeenCalled();
  });

  it("reports a storage failure instead of throwing it at the caller", async () => {
    // The assertion that matters: `resolves`, not `rejects`. A throw here would
    // propagate out of deleteOwnAccount and 500 the deletion request — a bucket
    // outage must not be able to refuse a user's right to delete their account.
    configure();
    send.mockRejectedValue(new Error("bucket unreachable"));
    await expect(deleteStoredObject("avatars/u1/abc.png")).resolves.toBe("failed");
  });
});
