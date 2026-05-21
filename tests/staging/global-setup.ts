import { clerkSetup } from "@clerk/testing/playwright";
import { assertStagingPlaywrightEnv } from "./fixtures.js";

export default async function globalSetup(): Promise<void> {
  assertStagingPlaywrightEnv();
  const secret = process.env.CLERK_SECRET_KEY ?? "";
  if (!secret.startsWith("sk_test_")) return;

  await clerkSetup({
    publishableKey: process.env.VITE_CLERK_PUBLISHABLE_KEY,
    secretKey: secret,
  });
}
