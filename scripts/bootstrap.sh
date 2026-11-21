#!/usr/bin/env bash
set -euo pipefail

echo "→ Checking system dependencies..."

command -v pnpm >/dev/null || { echo "✗ pnpm not found. Install: https://pnpm.io"; exit 1; }

required_node=22
current_node=$(node -v | sed 's/v//' | cut -d. -f1)
[ "$current_node" -ge "$required_node" ] || { echo "✗ Need Node $required_node+, got $current_node"; exit 1; }

# Without Docker, the offline stack runs the same services natively from
# vendored binaries (offline/README.md).
if ! command -v docker >/dev/null; then
  echo "→ Docker not found: setting up the offline stack (offline/README.md)"
  # The Supabase CLI's install script downloads its binary from GitHub, which an
  # offline machine cannot reach, and the offline stack does not use the CLI.
  # No other install script is needed: native packages ship prebuilt.
  pnpm install --ignore-scripts
  # Git hooks; a copy without .git (a zip) has none to install.
  if git rev-parse --git-dir >/dev/null 2>&1; then pnpm exec husky; fi
  node offline/stack.mts start
  echo ""
  echo "✓ Bootstrap complete. Run: pnpm dev"
  exit 0
fi

command -v jq >/dev/null || { echo "✗ jq not found. Install: 'apt install jq' or 'brew install jq'"; exit 1; }

echo "✓ System dependencies OK"

echo "→ Installing dependencies..."
pnpm install

echo "→ Starting Supabase..."
pnpm exec supabase start

echo "→ Starting Redis for the rate-limit tests..."
docker compose up -d --wait

echo "→ Populating .env.local from Supabase status..."
if [ ! -f .env.local ]; then
  cp .env.example .env.local

  ANON_KEY=$(pnpm exec supabase status -o json | jq -r '.ANON_KEY')
  SERVICE_KEY=$(pnpm exec supabase status -o json | jq -r '.SERVICE_ROLE_KEY')
  API_URL=$(pnpm exec supabase status -o json | jq -r '.API_URL')
  DB_URL=$(pnpm exec supabase status -o json | jq -r '.DB_URL')

  sed -i.bak "s|NEXT_PUBLIC_SUPABASE_URL=.*|NEXT_PUBLIC_SUPABASE_URL=$API_URL|" .env.local
  sed -i.bak "s|NEXT_PUBLIC_SUPABASE_ANON_KEY=.*|NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY|" .env.local
  sed -i.bak "s|SUPABASE_SERVICE_ROLE_KEY=.*|SUPABASE_SERVICE_ROLE_KEY=$SERVICE_KEY|" .env.local
  sed -i.bak "s|DATABASE_URL=.*|DATABASE_URL=$DB_URL|" .env.local
  rm -f .env.local.bak
fi

# Migrations applied by `supabase start` above. Drizzle-generated SQL
# files live alongside hand-authored ones in `supabase/migrations/` and
# run as a single ordered sequence. See ADR-0003.

echo ""
echo "✓ Bootstrap complete. Run: pnpm dev"
