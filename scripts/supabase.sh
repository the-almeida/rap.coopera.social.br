#!/usr/bin/env bash
# The `supabase:*` and `db:*` package scripts. With Docker it is the Supabase
# CLI, unchanged. Without Docker it drives the offline stack (offline/README.md),
# so `pnpm db:migrate`, `pnpm db:reset` and `pnpm supabase:status` work on both.
set -euo pipefail

if command -v docker >/dev/null; then
  exec supabase "$@"
fi

stack() { node offline/stack.mts "$@"; }

case "$*" in
  start) stack start ;;
  stop) stack stop ;;
  status) stack status ;;
  # `start` applies pending migrations; the CLI also needs the stack running.
  "migration up --local") stack start ;;
  # Like `supabase db reset`: a fresh database with every migration. The
  # offline reset also empties the inbox.
  "db reset") stack reset --yes && stack start ;;
  *)
    echo "✗ 'supabase $*' needs Docker. Without it, see offline/README.md." >&2
    exit 1
    ;;
esac
