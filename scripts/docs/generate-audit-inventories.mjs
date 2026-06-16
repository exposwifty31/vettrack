#!/usr/bin/env node
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractAllRoutes } from "../architecture/extract-express-routes.mjs";
import { formatRoutesMarkdown } from "./format-routes-markdown.mjs";
import { generateFrontendRoutesMarkdown } from "./extract-frontend-routes.mjs";
import { generateSchemaInventoryMarkdown } from "./extract-schema-inventory.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const auditDir = path.join(repoRoot, "docs/audit");
mkdirSync(auditDir, { recursive: true });

const routes = extractAllRoutes();
writeFileSync(path.join(auditDir, "routes.md"), formatRoutesMarkdown(routes), "utf8");
writeFileSync(path.join(auditDir, "frontend-routes.md"), generateFrontendRoutesMarkdown(), "utf8");
writeFileSync(path.join(auditDir, "db.md"), generateSchemaInventoryMarkdown(), "utf8");
console.log(`[docs:audit] Wrote 3 audit files (${routes.length} API routes)`);
