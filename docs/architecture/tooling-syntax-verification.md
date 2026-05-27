# Tooling syntax verification (pre-implementation)

**Verified:** 2026-05-27 against packages installed transiently in a clean workspace, then reverted from `package.json`.  
**Purpose:** Correct `architecture-hardening-addendum.md` before adding CI configs.

## Repository baseline (before any governance install)

| Tool | In `package.json`? | Config present? |
|------|-------------------|-----------------|
| **knip** | No (only `knip.json` exists) | `knip.json` — schema URL still points at **knip@5** |
| **madge** | No | None |
| **dependency-cruiser** | No | None |
| **ESLint** | No (only stray `eslint-disable` comments in source) | No `eslint.config.*` |

Hardening addendum text that says knip is “already in repo” as an installed tool is **incorrect** until `knip` is added to `devDependencies`.

---

## dependency-cruiser

**Version tested:** `17.4.2`  
**CLI binary:** `depcruise` (not `dependency-cruise`)  
**Init:** `npx depcruise --init` or `npx depcruise --init oneshot` → writes **`.dependency-cruiser.cjs`** (CommonJS + JSDoc `IConfiguration`).

### Config file names

| File | Works |
|------|--------|
| `.dependency-cruiser.cjs` | Yes (default from `--init`) |
| `dependency-cruiser.config.mjs` | Yes with `-c path` (ESM `export default`) |
| `.dependency-cruiser.js` | Supported by `-c` auto-discovery |

Hardening addendum’s `dependency-cruiser.config.mjs` is valid but **not** what `--init` generates; pick one convention.

### Valid `forbidden` rule shape (v17)

Top-level keys on a rule: `name`, `comment`, `severity`, `scope`, `from`, `to` only.  
**Invalid:** top-level `via` on a `forbidden` rule (schema: `additionalProperties: false` on rule object).

```javascript
// VALID — layer boundary
{
  name: "no-frontend-to-server",
  severity: "error",
  from: { path: "^src/" },
  to: { path: "^server/" },
}

// VALID — pathNot as string or array on from/to
{
  from: { path: "^src/features/[^/]+/" },
  to: { path: "^src/pages/[^/]+\\.tsx$", pathNot: "^src/features/[^/]+/index\\.tsx$" },
  // or pathNot: ["^src/features/[^/]+/index\\.tsx$"]
}
```

### Corrections to hardening addendum §1.2

| Addendum rule | Verdict | Fix |
|---------------|---------|-----|
| `integrations-stay-isolated` with top-level `via: { pathNot: [...] }` | **Invalid** | Use `from`/`to` only, or `to.circular` + `to.via` (see below), or `allowed` + `allowedSeverity` |
| `no-barrel-reexport-cycles` with `via: { dependencyTypes: ["reexport"] }` on non-circular rule | **Invalid** | `reexport` is not a valid `dependencyTypes` value for generic rules; use `no-circular` + `to.via` / `to.viaOnly`, or knip/dependency analysis |
| `from.pathNot: ["index"]` on `to` | **Valid** if regex is full path (prefer `"^...index\\.tsx$"` not bare `"index"`) |

### Where `via` / `viaOnly` are valid (v17)

Only on **`to`**, and primarily with **`circular: true`**:

```javascript
{
  name: "no-circular-except-type-only",
  severity: "error",
  from: {},
  to: {
    circular: true,
    viaOnly: { dependencyTypesNot: ["type-only"] },
  },
}
```

For “must not reach folder X from domain Y”, use **`to.reachable`** (`true` / `false`) with `from.path` + `to.path` / `to.pathNot` — not top-level `via`. See [rules reference — reachable](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md).

### `options` (verified against init template)

```javascript
options: {
  doNotFollow: { path: ["node_modules"] },  // array in .cruiser.cjs init
  tsPreCompilationDeps: true,               // valid (init default true)
  tsConfig: { fileName: "tsconfig.json" },  // prefer over bare enhancedResolveOptions unless needed
}
```

`enhancedResolveOptions` in addendum is optional; v17 init does not require it for this monorepo.

### CI command

```bash
# G1: grandfather existing violations; fail only on new ones
pnpm exec depcruise --config .dependency-cruiser.cjs --output-type err \
  --ignore-known .dependency-cruiser-known-violations.json server src

# Regenerate baseline after intentional fixes (review diff in PR):
pnpm depcruise:baseline

# Correct madge trees (no server/src):
pnpm architecture:cycles

# Wrong (ENOENT):
npx depcruise --config ... server/src
```

---

## madge

**Version tested:** `8.0.0`  
**CLI:** `madge` (no subcommand).

### Flags (from `madge --help`)

| Flag | Syntax |
|------|--------|
| Circular | `--circular` or `-c` |
| Extensions | `--extensions <list>` — **comma-separated**, e.g. `ts,tsx` (no spaces) |
| Basedir | `--basedir <path>` |
| JSON | `--json` or `-j` |
| Exclude | `--exclude <regexp>` |

### Correct CI examples

```bash
npx madge --circular --extensions ts server
npx madge --circular --extensions ts,tsx src
```

### Corrections to hardening addendum §1.3

```bash
# WRONG — path does not exist
npx madge --circular --extensions ts server/src

# WRONG — space-separated extensions
npx madge --circular --extensions ts tsx server
```

Madge does not ship a “compare to baseline” mode; `scripts/architecture/compare-cycles.mjs` must be custom.

---

## knip

**Version tested:** `6.14.2` (current npm `latest`)  
**CLI:** `knip`  
**Not installed** in repo `package.json` today.

### Config schema

```json
{
  "$schema": "https://unpkg.com/knip@6/schema.json"
}
```

Replace existing `knip.json` reference to **`knip@5/schema.json`** — wrong major for v6.

### CLI flags relevant to governance

| Flag | Purpose |
|------|---------|
| `-c, --config [file]` | Config path (default discovers `knip.json`) |
| `-p, --production` | Production-only analysis |
| `--include` / `--exclude` | Issue types (`exports`, `files`, `dependencies`, …) |
| `--max-issues N` | Exit 1 when total issues > N (default **0**) |
| `--no-exit-code` | Always exit 0 |
| `--tags` | JSDoc tag filter, e.g. `--tags=-lintignore` |
| `-W, --workspace` | Workspace filter (monorepo) |

**No built-in “changed files only” / PR-scoped mode.** PR gating requires:

- full run + `--max-issues` against a committed baseline, or
- wrapper script diffing `knip --reporter json` output, or
- `knip --workspace` + path filters.

### Ignoring exports (not `knip-ignore-next-line`)

Knip uses **JSDoc/TSDoc tags** + config `tags`, not ESLint-style line comments:

```typescript
/** @lintignore */
export const compatibilityBarrel = { ... };
```

```json
{
  "tags": ["-lintignore"]
}
```

Or `@public` for intentional public API surface. See https://knip.dev/reference/jsdoc-tsdoc-tags .

### `knip.json` `ignore` key

Still supported in v6 but Knip docs discourage broad `ignore`; prefer `entry` / `project`, `ignoreFiles`, `ignoreIssues`.

### Install + script

```json
{
  "devDependencies": {
    "knip": "^6.14.2"
  },
  "scripts": {
    "knip": "knip",
    "knip:production": "knip --production"
  }
}
```

---

## ESLint

**Version tested:** `10.4.0`  
**Config format:** **Flat config only** — `eslint.config.js` | `eslint.config.mjs` | `eslint.config.cjs`  
**Repo today:** no config file → `eslint` exits with “couldn't find eslint.config”.

### eslint-plugin-import @2.32.0 — do not use with ESLint 10

Peer dependency: `eslint@^2 || … || ^9` — **excludes ESLint 10**.  
`pnpm add -D eslint-plugin-import` reports peer warning with ESLint 10.

Hardening addendum examples using `eslint-plugin-import` + `no-restricted-imports` paths are **not viable** with ESLint 10 unless you pin **ESLint 9**.

### Recommended stack for ESLint 10 + TypeScript monorepo

| Package | Role |
|---------|------|
| `eslint@^10` | Core |
| `typescript-eslint@^8.60` | Parser + `tseslint.config()` helper |
| `eslint-plugin-import-x@^4` | Import rules (`peer`: eslint `^8.57 \|\| ^9 \|\| ^10`) |
| `eslint-import-resolver-typescript` | Resolve `@/` paths |

**Not verified in-repo:** `eslint-plugin-boundaries` (addendum mention) — add only after checking its peer range for ESLint 10.

### Flat config example (verified pattern for `no-restricted-imports`)

```javascript
// eslint.config.js
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import importX from "eslint-plugin-import-x";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["server/routes/domains/**/*.ts"],
    plugins: { "import-x": importX },
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{
          name: "../../db.js",
          message: "Handlers must not import db directly.",
        }],
      }],
    },
  },
  {
    ignores: ["dist/**", "node_modules/**"],
  },
);
```

Use **relative restricted paths** from the file being linted, or `import-x/no-restricted-paths` with zones — not `../db.js` copied from addendum without adjustment.

### Cyclomatic complexity

Not in ESLint core; needs `eslint-plugin-sonarjs` or similar — separate version check before adding to gates.

---

## Suggested pinned versions (G1 install)

```json
{
  "devDependencies": {
    "dependency-cruiser": "^17.4.2",
    "madge": "^8.0.0",
    "knip": "^6.14.2",
    "eslint": "^10.4.0",
    "typescript-eslint": "^8.60.0",
    "eslint-plugin-import-x": "^4.0.0",
    "eslint-import-resolver-typescript": "^4.0.0",
    "@eslint/js": "^10.0.0"
  }
}
```

**Do not add** `eslint-plugin-import@2.x` alongside ESLint 10.

---

## Hardening addendum errata summary

1. Install knip (and others) before claiming CI integration.  
2. `depcruise` + `.dependency-cruiser.cjs` naming.  
3. Remove invalid `forbidden` rules using top-level `via` or `dependencyTypes: ["reexport"]` outside `circular` rules.  
4. Madge: `server` and `src` separately; extensions `ts,tsx`.  
5. Knip: schema v6; tags not `knip-ignore-next-line`; no native PR-diff mode.  
6. ESLint: flat config; use `eslint-plugin-import-x` for ESLint 10, or pin ESLint 9 if staying on `eslint-plugin-import`.
