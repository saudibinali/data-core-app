#!/usr/bin/env bash
# F0.3 — Post-deploy smoke gate (< 5 min target)
# Usage: DATABASE_URL=postgresql://... ./scripts/post-deploy-smoke.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export RUN_POST_DEPLOY_SMOKE=1
export RUN_LEAVE_SMOKE="${RUN_LEAVE_SMOKE:-1}"

echo "==> Migration journal"
pnpm run validate:migration-journal

echo "==> Apply pending migrations (backup recommended: pnpm run db:backup)"
pnpm run db:migrate

echo "==> Workforce integrity"
pnpm run validate:workforce

echo "==> API production smoke suite"
pnpm --filter @workspace/api-server exec vitest run \
  src/routes/__tests__/production-smoke.core.test.ts \
  src/routes/__tests__/leave-canonical.smoke.test.ts \
  src/routes/__tests__/leave-bridge.smoke.test.ts

echo "==> Post-deploy smoke passed"
