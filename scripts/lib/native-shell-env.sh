#!/usr/bin/env bash
# Load Vite build-time vars for Capacitor bundled shells from .env only.
# .env.local intentionally blanks Clerk for local web dev — it must NOT affect native archives.

native_shell_read_env() {
  local key="$1"
  local file="${2:-.env}"
  if [[ ! -f "$file" ]]; then
    return 1
  fi
  grep "^${key}=" "$file" 2>/dev/null | tail -1 | cut -d= -f2- | sed 's/^["'\''"]//;s/["'\''"]$//'
}

# Sets and exports VITE_CLERK_PUBLISHABLE_KEY + VITE_API_ORIGIN. Returns 1 on missing values.
native_shell_load_build_env() {
  local env_file="${NATIVE_SHELL_ENV_FILE:-.env}"

  if [[ ! -f "$env_file" ]]; then
    echo "FAIL: $env_file not found — native shell needs VITE_CLERK_PUBLISHABLE_KEY and VITE_API_ORIGIN" >&2
    return 1
  fi

  VITE_CLERK_PUBLISHABLE_KEY="$(native_shell_read_env VITE_CLERK_PUBLISHABLE_KEY "$env_file")"
  VITE_API_ORIGIN="$(native_shell_read_env VITE_API_ORIGIN "$env_file")"

  if [[ -z "${VITE_CLERK_PUBLISHABLE_KEY}" ]]; then
    echo "FAIL: VITE_CLERK_PUBLISHABLE_KEY is empty in $env_file" >&2
    echo "      .env.local blanks Clerk for local web dev — native builds read $env_file only." >&2
    echo "      Use: ./scripts/build-native-shell.sh (not plain pnpm build + cap sync)" >&2
    return 1
  fi

  if [[ -z "${VITE_API_ORIGIN}" ]]; then
    echo "FAIL: VITE_API_ORIGIN is empty in $env_file (expected e.g. https://vettrack.uk)" >&2
    return 1
  fi

  # Trim trailing slash for consistency with src/lib/api-origin.ts
  VITE_API_ORIGIN="${VITE_API_ORIGIN%/}"

  export VITE_CLERK_PUBLISHABLE_KEY VITE_API_ORIGIN
  return 0
}

native_shell_key_prefix() {
  local key="${1:-}"
  if [[ ${#key} -ge 12 ]]; then
    echo "${key:0:12}..."
  else
    echo "(set)"
  fi
}
