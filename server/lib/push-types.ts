/** Uniform per-subscription send outcome across web-push / APNs / FCM transports. */
export type PushDispatchOutcome = "ok" | "expired" | "invalid" | "error" | "skipped";
