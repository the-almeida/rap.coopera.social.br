#!/usr/bin/env bash
set -euo pipefail

# Without Docker, the offline stack stands in for Supabase (offline/README.md).
if ! command -v docker >/dev/null; then
  node offline/stack.mts start
  exec pnpm exec next dev
fi

if ! pnpm exec supabase status >/dev/null 2>&1; then
  echo "→ Starting Supabase..."
  pnpm exec supabase start
fi

# Redis + serverless-redis-http for the rate-limit tests (idempotent).
docker compose up -d --wait

pnpm exec next dev
