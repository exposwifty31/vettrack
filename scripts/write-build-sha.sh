#!/bin/bash
#
# Resolve the deployed commit SHA on the HOST and write it into the Railway
# upload context, so the Docker build can stamp it into build-info.json.
#
# This exists because the SHA cannot be resolved inside the build: `railway up`
# strips .git unconditionally, .dockerignore strips it again, the Dockerfile
# declares no SHA build ARG, and RAILWAY_GIT_COMMIT_SHA is only set for
# GitHub-triggered deploys (we use `railway up --ci`). See scripts/build-sha.ts
# for the full derivation. The file rides inside the same tarball as the code it
# describes, so SHA and code can never be mispaired.
#
# Split out of deploy.sh so it is testable in isolation — see
# tests/deploy-build-sha.test.ts.
#
# Usage: write-build-sha.sh [target-dir]      (default: the repo root)
# Env:
#   GITHUB_SHA             preferred source (always set on an Actions runner)
#   VT_BUILD_SHA_GIT_DIR   git checkout to fall back to (default: target-dir)
# `-e` as well as `-u`, and it is load-bearing: with `-u` alone a failed redirection
# on the write below still let the next line succeed and the script exit 0, so
# deploy.sh proceeded to `railway up` with a missing or stale SHA file despite
# being written to abort. Its own `set -e` cannot help when the child reports
# success. That is the same false-pass this whole change exists to remove, in the
# producer. The only deliberately-tolerated non-zero exit here is the `git
# rev-parse` fallback, which is already guarded with `|| true`.
set -eu

target_dir="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
git_dir="${VT_BUILD_SHA_GIT_DIR:-$target_dir}"

# Keep in sync with BUILD_SHA_FILENAME in scripts/build-sha.ts.
sha_file="$target_dir/vt-build-sha.txt"

sha="${GITHUB_SHA:-}"
if [ -z "$sha" ]; then
  # Hand-run deploys from a developer machine have no Actions env but do have a
  # real .git. This fallback is safe HERE and only here: on the host, .git exists.
  sha="$(git -C "$git_dir" rev-parse HEAD 2>/dev/null || true)"
fi
sha="$(printf '%s' "$sha" | tr -d '[:space:]')"

if [ -z "$sha" ]; then
  echo "❌ Cannot resolve a commit SHA (GITHUB_SHA unset and no git checkout at $git_dir)." >&2
  echo "   Refusing to write a blank $sha_file — a blank or stale SHA would let" >&2
  echo "   scripts/verify-prod-deploy.ts report success against the wrong commit." >&2
  exit 1
fi

# `>` never `>>`: always overwrite, so a re-run cannot leave a stale SHA behind.
printf '%s\n' "$sha" > "$sha_file"
echo "🔖 Deploy context SHA: $sha -> $sha_file"
