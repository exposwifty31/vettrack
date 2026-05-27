/**
 * Tenant-scoped Drizzle table identifiers (export const name) derived from server/schema/.
 * A table is tenant-bound when its vtTable/pgTable definition includes a clinicId column.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaDir = path.resolve(__dirname, "../../../server/schema");

/** Tables that have clinicId in schema but are excluded from tenant-from lint (reason in comment). */
export const TENANT_TABLE_EXCLUDE = new Set([
  // Root tenant entity — queries use clinics.id, not clinics.clinicId
  "clinics",
]);

/** Optional manual additions when schema layout is non-standard (keep empty when possible). */
export const TENANT_TABLE_EXTRA = new Set([]);

const SCHEMA_FILES = ["core.ts", "billing.ts", "tasks.ts", "medication.ts", "equipment.ts", "inventory.ts", "er.ts", "ops.ts", "integrations.ts"];

/**
 * @returns {Set<string>} Drizzle export identifiers (e.g. equipment, appointments)
 */
export function buildTenantTableRegistry() {
  const tables = new Set([...TENANT_TABLE_EXTRA]);

  for (const file of SCHEMA_FILES) {
    const filePath = path.join(schemaDir, file);
    let source;
    try {
      source = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    parseSchemaFile(source, tables);
  }

  for (const name of TENANT_TABLE_EXCLUDE) {
    tables.delete(name);
  }

  return tables;
}

/**
 * @param {string} source
 * @param {Set<string>} out
 */
function parseSchemaFile(source, out) {
  const exportRe = /export\s+const\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*vtTable\s*\(/g;
  let match;
  while ((match = exportRe.exec(source)) !== null) {
    const name = match[1];
    const openParen = match.index + match[0].length - 1;
    const block = extractBalancedParens(source, openParen);
    if (!block) continue;
    if (/\bclinicId\s*:/.test(block)) {
      out.add(name);
    }
  }
}

/**
 * @param {string} source
 * @param {number} openIndex index of '('
 * @returns {string | null} content inside outer parens including nested
 */
function extractBalancedParens(source, openIndex) {
  if (source[openIndex] !== "(") return null;
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        return source.slice(openIndex, i + 1);
      }
    }
  }
  return null;
}

/** @returns {string[]} sorted table names for reporting */
export function listTenantTables() {
  return [...buildTenantTableRegistry()].sort();
}
