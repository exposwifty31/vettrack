import { execSync } from "child_process";

/**
 * Optional post-run cleanup when STAGING_E2E_AUTO_CLEANUP=yes.
 */
export default async function globalTeardown(): Promise<void> {
  if (process.env.STAGING_E2E_AUTO_CLEANUP !== "yes") {
    console.info(
      "[staging-e2e] Skipping auto-cleanup. Run pnpm staging:cleanup when finished.",
    );
    return;
  }
  execSync("pnpm staging:cleanup", { stdio: "inherit", env: process.env });
}
