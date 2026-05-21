import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { resolve } from "path";

export type StagingE2eManifestEntry = {
  key: string;
  email: string;
  clerkUserId: string;
  vtUserId: string;
  role: string;
  status: string;
};

export type StagingE2eManifest = {
  version: 1;
  clinicId: string;
  createdAt: string;
  personas: StagingE2eManifestEntry[];
  codeBlueSessionIds?: string[];
};

const MANIFEST_FILENAME = ".staging-e2e-manifest.json";

export function manifestPath(): string {
  return resolve(process.cwd(), MANIFEST_FILENAME);
}

export function readManifest(): StagingE2eManifest | null {
  const path = manifestPath();
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StagingE2eManifest;
  } catch {
    return null;
  }
}

export function writeManifest(manifest: StagingE2eManifest): void {
  writeFileSync(manifestPath(), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export function clearManifest(): void {
  const path = manifestPath();
  if (existsSync(path)) {
    unlinkSync(path);
  }
}
