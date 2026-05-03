import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";

const PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: "Hardcoded JWT secret", regex: /jwt[_\-]?secret\s*[:=]\s*["'][^"']{8,}["']/i },
  { name: "Clerk publishable key", regex: /pk_(live|test)_[A-Za-z0-9]{10,}/i },
  { name: "Clerk secret key", regex: /sk_(live|test)_[A-Za-z0-9]{10,}/i },
  { name: "Database URL with credentials", regex: /postgres:\/\/[^:]+:[^@]+@/i },
  { name: "VAPID private key (hardcoded)", regex: /vapid_private_key\s*[:=]\s*["'][A-Za-z0-9_\-]{20,}["']/i },
  { name: "Dev fallback secret", regex: /vettrack-dev-secret|dev-secret-key/i },
  { name: "Generic hardcoded secret", regex: /secret\s*[:=]\s*["'][a-zA-Z0-9!@#$%^&*]{12,}["']/i },
  { name: "Bearer token hardcoded", regex: /Authorization:\s*["']?Bearer\s+[A-Za-z0-9_\-.]{20,}["']?/i },
  { name: "Private key block", regex: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/ },
];


export const ALLOWLIST_BY_PATTERN: Record<string, Array<{ path: RegExp; line: RegExp }>> = {
  "Database URL with credentials": [
    {
      path: /^tests\/.*$/,
      line: /postgres:\/\/[^\s"']+@(?:localhost|127\.0\.0\.1):\d+\/[A-Za-z0-9_-]+/i,
    },
    {
      path: /^setup-vm\.sh$/,
      line: /DATABASE_URL=postgres:\/\/[^\s"']+@localhost:5432\/vettrack/i,
    },
  ],
};

const EXCLUDE_DIRS = ["node_modules", ".git", "dist", ".local", "attached_assets"];
const EXCLUDE_FILES = [
  "scan-secrets.ts",
  "envValidation.ts",
  "validate-prod.ts",
  ".env",
  ".env.example",
  "*.log",
];

export function shouldExclude(filePath: string): boolean {
  for (const dir of EXCLUDE_DIRS) {
    if (filePath.includes(`/${dir}/`) || filePath.startsWith(`${dir}/`)) return true;
  }
  const base = path.basename(filePath);
  for (const pat of EXCLUDE_FILES) {
    if (pat.startsWith("*.")) {
      if (base.endsWith(pat.slice(1))) return true;
    } else {
      if (base === pat) return true;
    }
  }
  return false;
}

export function isAllowedHit(pattern: string, relPath: string, line: string): boolean {
  const allowlisted = ALLOWLIST_BY_PATTERN[pattern];
  if (!allowlisted) return false;
  return allowlisted.some((rule) => rule.path.test(relPath) && rule.line.test(line));
}

export function scanFile(filePath: string, relPath: string): Array<{ pattern: string; line: number; content: string }> {
  const hits: Array<{ pattern: string; line: number; content: string }> = [];
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return hits;
  }
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { name, regex } of PATTERNS) {
      if (regex.test(line) && !isAllowedHit(name, relPath, line)) {
        hits.push({ pattern: name, line: i + 1, content: line.trim().slice(0, 120) });
      }
    }
  }
  return hits;
}

export function getFiles(dir: string): string[] {
  const files: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(process.cwd(), fullPath);
    if (shouldExclude(relPath)) continue;
    if (entry.isDirectory()) {
      files.push(...getFiles(fullPath));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".sh", ".env"].includes(ext)) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

export function main() {
  const rootDir = process.cwd();
  const files = getFiles(rootDir);
  let totalHits = 0;

  for (const file of files) {
    const relPath = path.relative(rootDir, file);
    const hits = scanFile(file, relPath);
    if (hits.length > 0) {
      for (const hit of hits) {
        console.log(`\n[SECRET SCAN] ${hit.pattern}`);
        console.log(`  File: ${relPath}:${hit.line}`);
        console.log(`  Content: ${hit.content}`);
        totalHits++;
      }
    }
  }

  if (totalHits > 0) {
    console.error(`\n❌ Secret scan found ${totalHits} potential secret(s). Fix them before deploying.\n`);
    process.exit(1);
  } else {
    console.log("✅ Secret scan passed — no hardcoded secrets detected.");
  }
}

const entryArg = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryArg) {
  main();
}
