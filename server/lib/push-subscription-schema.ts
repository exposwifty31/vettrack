/**
 * POST /api/push/subscribe body validation (G4-2 / ADR-009).
 *
 * Web-push clients keep the URL-endpoint shape. Native clients (APNs/FCM/Expo)
 * send an opaque device `token` validated PER PLATFORM FORMAT — never as a URL,
 * which is what the old `endpoint: z.string().url()` validator rejected them on.
 *
 * Backward compatibility: existing web/PWA clients POST no `platform` field, so
 * an absent platform is treated as "web".
 */
import { z } from "zod";

const notificationSettings = {
  soundEnabled: z.boolean().optional(),
  alertsEnabled: z.boolean().optional(),
  technicianReturnRemindersEnabled: z.boolean().optional(),
  seniorOwnReturnRemindersEnabled: z.boolean().optional(),
  seniorTeamOverdueAlertsEnabled: z.boolean().optional(),
  adminHourlySummaryEnabled: z.boolean().optional(),
};

// APNs device token: hex, 64+ chars. (Not a URL.)
const IOS_TOKEN_RE = /^[0-9a-fA-F]{64,}$/;
// FCM registration token: opaque, letters/digits/_ : . - (no slashes → not a URL).
const FCM_TOKEN_RE = /^[A-Za-z0-9_:.-]{20,}$/;
// Expo push token: ExponentPushToken[...] / ExpoPushToken[...].
const EXPO_TOKEN_RE = /^Expo(nent)?PushToken\[[^\]]+\]$/;

const webSubscribeSchema = z.object({
  platform: z.literal("web").optional(),
  endpoint: z.string().url("endpoint must be a valid URL"),
  keys: z.object({
    p256dh: z.string().min(1, "p256dh is required"),
    auth: z.string().min(1, "auth is required"),
  }),
  ...notificationSettings,
});

const nativeSubscribeSchema = z
  .object({
    platform: z.enum(["ios", "android", "expo"]),
    token: z.string().min(1, "token is required"),
    ...notificationSettings,
  })
  .superRefine((val, ctx) => {
    const re =
      val.platform === "ios" ? IOS_TOKEN_RE : val.platform === "expo" ? EXPO_TOKEN_RE : FCM_TOKEN_RE;
    if (!re.test(val.token)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["token"],
        message: `token is not a valid ${val.platform} device token`,
      });
    }
  });

/** Native branch first so a platform-tagged body isn't shadowed by the web shape. */
export const subscribeSchema = z.union([nativeSubscribeSchema, webSubscribeSchema]);

export type SubscribeBody = z.infer<typeof subscribeSchema>;

/** True for the native (token-carrying) branch. */
export function isNativeSubscribeBody(
  body: SubscribeBody,
): body is z.infer<typeof nativeSubscribeSchema> {
  return "token" in body && typeof (body as { token?: unknown }).token === "string";
}
