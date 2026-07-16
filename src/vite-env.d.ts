/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __VT_BUILD_TAG__: string;

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

interface Window {
  startRecording?: () => void;
  stopRecording?: () => void;
}

interface ImportMetaEnv {
  readonly VITE_CLERK_PUBLISHABLE_KEY: string;
  /**
   * Dev-only escape hatch: `"true"` forces client dev-bypass even when a Clerk key
   * is present (for role-cycling tooling — the flow-walk, DevRoleSwitcher). Honored
   * only under `import.meta.env.DEV`; inert in production/native builds. Start via
   * `pnpm dev:bypass`. See `isClerkEnabled()` in `src/lib/auth-fetch.ts`.
   */
  readonly VITE_FORCE_DEV_BYPASS?: string;
  /** Production API host for bundled Capacitor shell (e.g. https://vettrack.uk). */
  readonly VITE_API_ORIGIN?: string;
  readonly VITE_WHATSAPP_PHONE: string;
  readonly VITE_OFFLINE_PHASE9_POST_SYNC_RECONCILIATION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
