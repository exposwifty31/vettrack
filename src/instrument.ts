import * as Sentry from "@sentry/react";

declare const __APP_VERSION__: string;

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    release: typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : undefined,

    // sendDefaultPii would attach the visitor's IP, cookies, and full
    // request bodies to every event by default (Sentry docs: deprecated in
    // favor of explicit dataCollection categories). This app already sets
    // user context explicitly (see Sentry.setUser in server/middleware/auth.ts)
    // and Session Replay masks its own content via maskAllText/blockAllMedia
    // below — neither needs the blanket flag, and cookies here would include
    // the live Clerk session.
    sendDefaultPii: false,
    enableLogs: true,

    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],

    tracesSampleRate: import.meta.env.MODE === "production" ? 0.2 : 1.0,
    tracePropagationTargets: [/^\/api/, "localhost"],

    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
  });
}

declare global {
  interface Window {
    __vettrackGlobalErrorHandlersAttached__?: boolean;
  }
}

if (typeof window !== "undefined" && !window.__vettrackGlobalErrorHandlersAttached__) {
  window.__vettrackGlobalErrorHandlersAttached__ = true;

  window.addEventListener("error", (event) => {
    Sentry.captureException(event.error ?? new Error(event.message));
  });

  window.addEventListener("unhandledrejection", (event) => {
    Sentry.captureException(event.reason ?? new Error("Unhandled promise rejection"));
  });
}
