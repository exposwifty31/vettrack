/**
 * Fixed staging E2E personas — emails are stable; Clerk users are ephemeral per run.
 */

export type StagingPersonaKey =
  | "admin"
  | "vet"
  | "technician"
  | "student"
  | "pending"
  | "blocked";

export type StagingPersona = {
  key: StagingPersonaKey;
  email: string;
  role: "admin" | "vet" | "technician" | "student";
  status: "active" | "pending" | "blocked";
  name: string;
  /** Open clinical check-in for Code Blue authority (vet / technician). */
  clinicalCheckIn?: boolean;
  /** Can act as Code Blue session manager in API tests. */
  codeBlueManager?: boolean;
};

/** Clerk accepts standard domains; .test TLD is rejected by the API. */
export const STAGING_E2E_EMAIL_DOMAIN = "vettrack-e2e.example.com";
export const STAGING_E2E_EMAIL_PREFIX = "staging-e2e";

export function stagingPersonaEmail(key: StagingPersonaKey): string {
  return `${STAGING_E2E_EMAIL_PREFIX}-${key}@${STAGING_E2E_EMAIL_DOMAIN}`;
}

export const STAGING_PERSONAS: readonly StagingPersona[] = [
  {
    key: "admin",
    email: stagingPersonaEmail("admin"),
    role: "admin",
    status: "active",
    name: "Staging E2E Admin",
    codeBlueManager: true,
  },
  {
    key: "vet",
    email: stagingPersonaEmail("vet"),
    role: "vet",
    status: "active",
    name: "Staging E2E Vet",
    clinicalCheckIn: true,
    codeBlueManager: true,
  },
  {
    key: "technician",
    email: stagingPersonaEmail("technician"),
    role: "technician",
    status: "active",
    name: "Staging E2E Technician",
    clinicalCheckIn: true,
  },
  {
    key: "student",
    email: stagingPersonaEmail("student"),
    role: "student",
    status: "active",
    name: "Staging E2E Student",
  },
  {
    key: "pending",
    email: stagingPersonaEmail("pending"),
    role: "technician",
    status: "pending",
    name: "Staging E2E Pending",
  },
  {
    key: "blocked",
    email: stagingPersonaEmail("blocked"),
    role: "technician",
    status: "blocked",
    name: "Staging E2E Blocked",
  },
] as const;

export const STAGING_E2E_CLINIC_ID =
  (process.env.STAGING_E2E_CLINIC_ID ?? "dev-clinic-default").trim();
