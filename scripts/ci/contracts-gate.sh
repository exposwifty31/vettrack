#!/usr/bin/env bash
# Shared gate for @vettrack/contracts (local workspace package: packages/contracts).
set -euo pipefail

pnpm run contracts:typecheck
pnpm test -- tests/offline-phase-7-emergency-surface-parity.test.ts
