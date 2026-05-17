#!/usr/bin/env tsx
/**
 * Deep key-set parity check between `locales/en.json` and `locales/he.json`.
 *
 * Both files MUST have identical key paths (including any `_meta.*`
 * non-rendering metadata keys, which are part of parity per Phase 6 §5
 * invariant 13). Exits non-zero on divergence.
 *
 * Invoked via `pnpm i18n:check` and from the parity vitest test.
 */

import { readFileSync } from "fs";
import { resolve } from "path";

type Dict = { [k: string]: Dict | string | number | boolean | null };

function collectKeyPaths(node: unknown, prefix: string, out: Set<string>): void {
  if (node === null || typeof node !== "object" || Array.isArray(node)) {
    if (prefix) out.add(prefix);
    return;
  }
  for (const [key, value] of Object.entries(node as Dict)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      collectKeyPaths(value, path, out);
    } else {
      out.add(path);
    }
  }
}

export interface ParityResult {
  inEnNotHe: string[];
  inHeNotEn: string[];
}

export function compareParity(enDict: unknown, heDict: unknown): ParityResult {
  const enKeys = new Set<string>();
  const heKeys = new Set<string>();
  collectKeyPaths(enDict, "", enKeys);
  collectKeyPaths(heDict, "", heKeys);

  const inEnNotHe = [...enKeys].filter((k) => !heKeys.has(k)).sort();
  const inHeNotEn = [...heKeys].filter((k) => !enKeys.has(k)).sort();
  return { inEnNotHe, inHeNotEn };
}

export function loadLocaleFile(name: "en" | "he"): unknown {
  const path = resolve(process.cwd(), "locales", `${name}.json`);
  return JSON.parse(readFileSync(path, "utf-8"));
}

function isMainModule(): boolean {
  const url = import.meta.url;
  return typeof process !== "undefined" && url.endsWith(process.argv[1] ?? "");
}

if (isMainModule()) {
  const en = loadLocaleFile("en");
  const he = loadLocaleFile("he");
  const { inEnNotHe, inHeNotEn } = compareParity(en, he);

  if (inEnNotHe.length === 0 && inHeNotEn.length === 0) {
    console.log("✓ locales/en.json and locales/he.json are in deep key parity.");
    process.exit(0);
  }

  console.error("✗ Locale parity failed.");
  if (inEnNotHe.length > 0) {
    console.error(`\nKeys present in en.json but missing from he.json (${inEnNotHe.length}):`);
    for (const k of inEnNotHe) console.error(`  - ${k}`);
  }
  if (inHeNotEn.length > 0) {
    console.error(`\nKeys present in he.json but missing from en.json (${inHeNotEn.length}):`);
    for (const k of inHeNotEn) console.error(`  - ${k}`);
  }
  process.exit(1);
}
