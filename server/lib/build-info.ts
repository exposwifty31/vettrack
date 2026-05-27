import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

export interface BuildInfo {
  appVersion: string;
  buildTag: string;
  vitePilotMode: boolean;
  builtAt: string;
  gitCommit: string | null;
}

const DIST_BUILD_INFO = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../dist/public/build-info.json",
);

let cached: BuildInfo | null | undefined;

export function loadBuildInfo(): BuildInfo | null {
  if (cached !== undefined) return cached;
  if (!existsSync(DIST_BUILD_INFO)) {
    cached = null;
    return null;
  }
  try {
    const raw = JSON.parse(readFileSync(DIST_BUILD_INFO, "utf-8")) as BuildInfo;
    cached = raw;
    return raw;
  } catch {
    cached = null;
    return null;
  }
}

export function resolveBackendPilotMode(): boolean {
  return process.env.PILOT_MODE === "true";
}

export function resolveFrontendPilotMode(): boolean | null {
  const info = loadBuildInfo();
  if (!info) return null;
  return info.vitePilotMode === true;
}
