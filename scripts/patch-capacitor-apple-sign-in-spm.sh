#!/usr/bin/env bash
# Capacitor 8 + @capgo/capacitor-nfc require capacitor-swift-pm 8.x, but
# @capacitor-community/apple-sign-in@7.1.0 still ships Package.swift with
# `from: "7.0.0"`. Without this patch, Xcode reports:
#   Missing package product 'CapApp-SPM'
# Run after pnpm install, before `cap sync ios` / Archive.
set -euo pipefail

REPO="${REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$REPO"

shopt -s nullglob
paths=(
  "$REPO"/node_modules/.pnpm/@capacitor-community+apple-sign-in@*/node_modules/@capacitor-community/apple-sign-in/Package.swift
  "$REPO"/node_modules/@capacitor-community/apple-sign-in/Package.swift
)

target=""
for p in "${paths[@]}"; do
  if [[ -f "$p" ]]; then
    target="$p"
    break
  fi
done

if [[ -z "$target" ]]; then
  echo "patch-capacitor-apple-sign-in-spm: plugin not installed — skip" >&2
  exit 0
fi

if grep -q 'capacitor-swift-pm.git", from: "8.0.0"' "$target"; then
  echo "patch-capacitor-apple-sign-in-spm: already patched ($target)"
  exit 0
fi

if ! grep -q 'capacitor-swift-pm.git", from: "7.0.0"' "$target"; then
  echo "patch-capacitor-apple-sign-in-spm: unexpected Package.swift — manual review needed: $target" >&2
  exit 1
fi

perl -pi -e 's/capacitor-swift-pm\.git", from: "7\.0\.0"/capacitor-swift-pm.git", from: "8.0.0"/' "$target"
echo "patch-capacitor-apple-sign-in-spm: patched $target → capacitor-swift-pm from 8.0.0"
