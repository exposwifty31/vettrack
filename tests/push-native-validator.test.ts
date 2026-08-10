/**
 * G4-2 — POST /api/push/subscribe must accept native (APNs/FCM/Expo) device
 * tokens, not only web-push URL endpoints.
 *
 * Today the Zod validator rejects any non-URL token (endpoint: z.string().url()),
 * so an iOS/Android device token 400s before it can be stored. The branched
 * validator must:
 *   - keep accepting legacy web bodies (no `platform` field → treated as web);
 *   - accept ios/android/expo bodies carrying an opaque `token` (validated per
 *     platform format, NOT as a URL);
 *   - reject unknown platforms and native bodies missing a token.
 *
 * Pure schema test — no db, no network.
 */
import { describe, it, expect } from "vitest";
import { subscribeSchema } from "../server/lib/push-subscription-schema.js";

const IOS_TOKEN = "a".repeat(64); // APNs device token: hex string
const FCM_TOKEN =
  "cZ1a2b3c4d:APA91bHunX-9_abcDEF0123456789ghijklmnopqrstuvwx_yz-ABCDEFG"; // opaque FCM registration token
const EXPO_TOKEN = "ExponentPushToken[abcdEFGH1234567890xyz]";

describe("push subscribe validator — native tokens", () => {
  it("accepts a legacy web body with no platform field (backward compatible)", () => {
    const r = subscribeSchema.safeParse({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
      keys: { p256dh: "p256dh-key", auth: "auth-key" },
      alertsEnabled: true,
    });
    expect(r.success).toBe(true);
  });

  it("accepts an explicit web platform body", () => {
    const r = subscribeSchema.safeParse({
      platform: "web",
      endpoint: "https://updates.push.services.mozilla.com/wpush/v2/abc",
      keys: { p256dh: "p256dh-key", auth: "auth-key" },
    });
    expect(r.success).toBe(true);
  });

  it("accepts an iOS APNs token body", () => {
    const r = subscribeSchema.safeParse({ platform: "ios", token: IOS_TOKEN });
    expect(r.success).toBe(true);
  });

  it("accepts an Android FCM token body", () => {
    const r = subscribeSchema.safeParse({ platform: "android", token: FCM_TOKEN });
    expect(r.success).toBe(true);
  });

  it("accepts an Expo token body", () => {
    const r = subscribeSchema.safeParse({ platform: "expo", token: EXPO_TOKEN });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown platform", () => {
    const r = subscribeSchema.safeParse({ platform: "windows", token: "whatever" });
    expect(r.success).toBe(false);
  });

  it("rejects a native body missing its token", () => {
    const r = subscribeSchema.safeParse({ platform: "ios" });
    expect(r.success).toBe(false);
  });

  it("rejects an iOS body whose token is a URL, not a device token", () => {
    const r = subscribeSchema.safeParse({
      platform: "ios",
      token: "https://example.com/not-a-token",
    });
    expect(r.success).toBe(false);
  });

  it("still rejects a web body with a non-URL endpoint", () => {
    const r = subscribeSchema.safeParse({
      endpoint: "not-a-url",
      keys: { p256dh: "x", auth: "y" },
    });
    expect(r.success).toBe(false);
  });
});
