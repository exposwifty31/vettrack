import {
  STAGING_PERSONAS,
  STAGING_E2E_CLINIC_ID,
  stagingPersonaEmail,
  type StagingPersona,
  type StagingPersonaKey,
} from "../../scripts/staging/personas.js";
import { readManifest } from "../../scripts/staging/manifest.js";

export {
  STAGING_PERSONAS,
  STAGING_E2E_CLINIC_ID,
  stagingPersonaEmail,
  type StagingPersona,
  type StagingPersonaKey,
};

export const STAGING_BASE_URL =
  (process.env.TEST_BASE_URL ?? "https://vettrack-staging.up.railway.app").replace(/\/$/, "");

export function stagingE2ePassword(): string {
  const password = (process.env.STAGING_E2E_PASSWORD ?? "").trim();
  if (!password) {
    throw new Error("STAGING_E2E_PASSWORD is required for staging Playwright E2E");
  }
  return password;
}

export function assertStagingPlaywrightEnv(): void {
  const secret = (process.env.CLERK_SECRET_KEY ?? "").trim();
  if (!secret.startsWith("sk_test_")) {
    throw new Error("Staging E2E requires sk_test_ CLERK_SECRET_KEY");
  }
  const publishable = (process.env.VITE_CLERK_PUBLISHABLE_KEY ?? "").trim();
  if (publishable.startsWith("pk_live_")) {
    throw new Error("Refusing pk_live_ for staging E2E");
  }
  if (!STAGING_BASE_URL.includes("staging")) {
    throw new Error(`TEST_BASE_URL must be staging (${STAGING_BASE_URL})`);
  }
}

export type ManifestSnapshot = {
  personas: Array<{
    key: StagingPersonaKey;
    vtUserId: string;
    clerkUserId: string;
    email: string;
    role: string;
    status: string;
  }>;
};

export function loadManifest(): ManifestSnapshot | null {
  const manifest = readManifest();
  if (!manifest?.personas?.length) return null;
  return { personas: manifest.personas as ManifestSnapshot["personas"] };
}

export function personaByKey(key: StagingPersonaKey): StagingPersona {
  const p = STAGING_PERSONAS.find((x) => x.key === key);
  if (!p) throw new Error(`Unknown persona: ${key}`);
  return p;
}
