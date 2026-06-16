#!/usr/bin/env node
/**
 * Extract Drizzle table names from server/schema/*.ts for docs/audit/db.md.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const schemaDir = path.join(repoRoot, "server/schema");

const SCHEMA_FILES = [
  { file: "core.ts", title: "Core (`server/schema/core.ts`)" },
  { file: "equipment.ts", title: "Equipment (`server/schema/equipment.ts`)" },
  { file: "er.ts", title: "Emergency & safety (`server/schema/er.ts`)" },
  { file: "inventory.ts", title: "Inventory (`server/schema/inventory.ts`)" },
  { file: "tasks.ts", title: "Tasks / appointments (`server/schema/tasks.ts`)" },
  { file: "ops.ts", title: "Operations (`server/schema/ops.ts`)" },
  { file: "integrations.ts", title: "Integrations (`server/schema/integrations.ts`)" },
];

const TABLE_RE = /vtTable\s*\(\s*["'](vt_[^"']+)["']/g;
const MULTILINE_TABLE_RE = /=\s*vtTable\s*\(\s*\n\s*["'](vt_[^"']+)["']/g;

function extractTableNames(source) {
  const names = new Set();
  let m;
  TABLE_RE.lastIndex = 0;
  while ((m = TABLE_RE.exec(source)) !== null) names.add(m[1]);
  MULTILINE_TABLE_RE.lastIndex = 0;
  while ((m = MULTILINE_TABLE_RE.exec(source)) !== null) names.add(m[1]);
  return [...names].sort();
}

export function generateSchemaInventoryMarkdown() {
  const generatedAt = new Date().toISOString().slice(0, 10);
  const lines = [
    "# VetTrack — Database Schema Inventory",
    "",
    "All tables prefixed `vt_`. Schema source of truth: `server/schema/` (re-exported from `server/schema/index.ts` and `server/db.ts`).",
    "",
    `Generated ${generatedAt}.`,
    "",
    "---",
    "",
  ];

  let total = 0;
  for (const { file, title } of SCHEMA_FILES) {
    const abs = path.join(schemaDir, file);
    const source = readFileSync(abs, "utf8");
    const tables = extractTableNames(source);
    total += tables.length;
    lines.push(`## ${title}`, "", "| Table |", "|-------|");
    for (const table of tables) lines.push(`| \`${table}\` |`);
    lines.push("");
  }

  lines.push("---", "", `**Total tables:** ${total}`, "");
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(generateSchemaInventoryMarkdown());
}
