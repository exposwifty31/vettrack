#!/usr/bin/env bash
# Shared gate for @vettrack/contracts (sourced from exposwifty31/literate-dollop).
set -euo pipefail

pnpm run contracts:typecheck
pnpm test -- tests/offline-phase-7-emergency-surface-parity.test.ts
