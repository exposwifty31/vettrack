#!/usr/bin/env tsx
/**
 * Sign an RFID batch JSON file for curl testing.
 * Usage: tsx scripts/rfid/sign-batch.ts <clinicId> <secret> <batch.json>
 */
import { createHmac } from "crypto";
import { readFileSync } from "fs";

const clinicId = process.argv[2]?.trim();
const secret = process.argv[3]?.trim();
const filePath = process.argv[4]?.trim();

if (!clinicId || !secret || !filePath) {
  console.error("Usage: tsx scripts/rfid/sign-batch.ts <clinicId> <secret> <batch.json>");
  process.exit(1);
}

const rawBody = readFileSync(filePath);
const sig = createHmac("sha256", secret).update(rawBody).digest("hex");

console.log(`curl -X POST http://localhost:3001/api/rfid/events \\`);
console.log(`  -H 'Content-Type: application/json' \\`);
console.log(`  -H 'X-VetTrack-Clinic: ${clinicId}' \\`);
console.log(`  -H 'X-VetTrack-Signature: sha256=${sig}' \\`);
console.log(`  --data-binary @${filePath}`);
