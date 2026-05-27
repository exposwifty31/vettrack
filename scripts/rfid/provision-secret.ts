#!/usr/bin/env tsx
/**
 * MVP: provision HMAC webhook secret for RFID doorway ingest.
 * Usage: tsx scripts/rfid/provision-secret.ts <clinicId>
 */
import "dotenv/config";
import { randomBytes } from "crypto";
import { storeCredentials } from "../../server/integrations/credential-manager.js";

const clinicId = process.argv[2]?.trim();
if (!clinicId) {
  console.error("Usage: tsx scripts/rfid/provision-secret.ts <clinicId>");
  process.exit(1);
}

const secret = randomBytes(32).toString("hex");

await storeCredentials(clinicId, "rfid", { webhook_secret: secret });

console.log(`RFID webhook secret stored for clinic ${clinicId}`);
console.log("Copy this secret now — it will not be shown again:");
console.log(secret);
