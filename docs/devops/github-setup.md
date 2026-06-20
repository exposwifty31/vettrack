# GitHub Repository Setup — Manual Steps

> **Context:** These settings require GitHub admin access to `exposwifty31/vettrack` and
> could not be applied automatically (GitHub CLI token was invalid at time of generation).
> Apply them once, then they persist.

---

## 1. Branch Protection — `main`

**Location:** GitHub → Settings → Branches → Add branch protection rule → `main`

Required settings:

| Setting | Value |
|---------|-------|
| Branch name pattern | `main` |
| Require a pull request before merging | ✅ enabled |
| Required approvals | 1 (or 0 for solo maintainer — see note) |
| Require status checks to pass before merging | ✅ enabled |
| Require branches to be up to date | ✅ enabled |
| Do not allow bypassing the above settings | ✅ recommended |
| Allow force pushes | ❌ disabled |
| Allow deletions | ❌ disabled |

### Required status checks

These are the exact job `name` values from the CI workflows. Add them in the "Search for status checks" box after enabling required checks:

**From `.github/workflows/ci.yml`:**
- `✅ Merge gate` — _the terminal gate job; already requires all other CI jobs_

> Alternatively, require all individual jobs (more granular but more maintenance):
> - `🧪 Tests & typecheck`
> - `🔌 Integration ops`
> - `🏛️ Architecture gates (G1)`

**From `.github/workflows/playwright.yml`** (matrix job — two shards):
- `🎭 Playwright E2E (shard 1)`
- `🎭 Playwright E2E (shard 2)`

> **Note for solo maintainer:** GitHub does not allow a single person to approve their own PR
> unless you disable required approvals or use a bot account. Set required approvals to `0`
> (review optional but PR still required) while operating solo, or enable admin bypass.

### Via GitHub CLI (once token is refreshed)

```bash
gh auth refresh -h github.com

gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  /repos/exposwifty31/vettrack/branches/main/protection \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "✅ Merge gate",
      "🎭 Playwright E2E (shard 1)",
      "🎭 Playwright E2E (shard 2)"
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0,
    "dismiss_stale_reviews": true
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
```

---

## 2. Delete Branch on Merge

**Location:** GitHub → Settings → General → Pull Requests → "Automatically delete head branches" → ✅

### Via GitHub CLI

```bash
gh api \
  --method PATCH \
  -H "Accept: application/vnd.github+json" \
  /repos/exposwifty31/vettrack \
  -f delete_branch_on_merge=true
```

---

## 3. Labels

**Location:** GitHub → Issues → Labels → New label

Create the following labels (or run the CLI commands):

| Name | Color | Description |
|------|-------|-------------|
| `P0` | `#d73a4a` | Production incident / must fix now |
| `P1` | `#e4e669` | High priority — next deployment |
| `P2` | `#0075ca` | Normal priority |
| `P3` | `#cfd3d7` | Low priority / nice to have |
| `equipment` | `#5319e7` | Equipment tracking domain |
| `native` | `#f9d0c4` | iOS / Capacitor native app |
| `ci` | `#0e8a16` | CI/CD pipeline |
| `docs` | `#d4c5f9` | Documentation only |
| `realtime-frozen` | `#ff6347` | Touches frozen realtime/PWA surfaces |
| `security` | `#b60205` | Security sensitive |
| `tenancy` | `#c2e0c6` | Multi-tenancy boundary |

### Via GitHub CLI (batch)

```bash
gh auth refresh -h github.com

declare -A labels=(
  ["P0"]="d73a4a:Production incident / must fix now"
  ["P1"]="e4e669:High priority — next deployment"
  ["P2"]="0075ca:Normal priority"
  ["P3"]="cfd3d7:Low priority / nice to have"
  ["equipment"]="5319e7:Equipment tracking domain"
  ["native"]="f9d0c4:iOS / Capacitor native app"
  ["ci"]="0e8a16:CI/CD pipeline"
  ["docs"]="d4c5f9:Documentation only"
  ["realtime-frozen"]="ff6347:Touches frozen realtime/PWA surfaces"
  ["security"]="b60205:Security sensitive"
  ["tenancy"]="c2e0c6:Multi-tenancy boundary"
)

for name in "${!labels[@]}"; do
  IFS=':' read -r color desc <<< "${labels[$name]}"
  gh api \
    --method POST \
    -H "Accept: application/vnd.github+json" \
    /repos/exposwifty31/vettrack/labels \
    -f name="$name" \
    -f color="$color" \
    -f description="$desc" \
    2>&1 | grep -E '"name"|error' || true
done
```

---

## 4. CODEOWNERS (already committed)

`.github/CODEOWNERS` is in the repo. It takes effect **after** branch protection is enabled —
GitHub only enforces CODEOWNERS review requirements when branch protection is active and
"Require review from Code Owners" is checked in the branch protection rule.

To enable in branch protection:

```
Settings → Branches → main protection rule → ✅ Require review from Code Owners
```

---

## 5. Dependabot (already committed)

`.github/dependabot.yml` is committed. Dependabot activates automatically once GitHub
detects the file on `main`. Verify at:

```
GitHub → Insights → Dependency graph → Dependabot
```

The `dependencies` label referenced in `dependabot.yml` should be created if it doesn't
already exist on the repo (it's a GitHub default label, usually present).

---

## Summary

| Item | Status | Action needed |
|------|--------|---------------|
| `.github/dependabot.yml` | ✅ committed | Push to `main`; activates automatically |
| `SECURITY.md` | ✅ committed | Push to `main`; verify `security@vettrack.uk` email |
| `.github/CODEOWNERS` | ✅ committed | Enable "Require review from Code Owners" in branch protection |
| Branch protection on `main` | ⚠️ manual | Run CLI command above or apply via GitHub UI |
| Delete branch on merge | ⚠️ manual | One checkbox in repo settings |
| Labels | ⚠️ manual | Run CLI batch above or create via GitHub Issues UI |
