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
  readonly VITE_WHATSAPP_PHONE: string;
  readonly VITE_OFFLINE_PHASE9_POST_SYNC_RECONCILIATION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
