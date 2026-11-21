#!/usr/bin/env bash
# Refreshes the vendored binaries of the offline stack. Needs internet; the
# offline machine never runs it. Pin the versions the Supabase CLI runs locally
# (`docker ps` while `supabase start` is up shows them), so both stacks behave
# the same. Then run `bash offline/vendor/fetch.sh` and commit what changed.
set -euo pipefail

AUTH_VERSION=2.188.1
MAILPIT_VERSION=1.22.3
POSTGREST_VERSION=14.7

cd "$(dirname "$0")"

fetch() {
  echo "→ $2"
  curl --fail --location --silent --show-error --output "$2" "$1"
}

rm -f auth-v*.tar.* mailpit-v*.tar.* postgrest-v*.tar.*

fetch "https://github.com/supabase/auth/releases/download/v${AUTH_VERSION}/auth-v${AUTH_VERSION}-x86.tar.gz" \
  "auth-v${AUTH_VERSION}-x86.tar.gz"
fetch "https://github.com/axllent/mailpit/releases/download/v${MAILPIT_VERSION}/mailpit-linux-amd64.tar.gz" \
  "mailpit-v${MAILPIT_VERSION}-linux-amd64.tar.gz"
fetch "https://github.com/PostgREST/postgrest/releases/download/v${POSTGREST_VERSION}/postgrest-v${POSTGREST_VERSION}-linux-static-x86-64.tar.xz" \
  "postgrest-v${POSTGREST_VERSION}-linux-static-x86-64.tar.xz"

fetch "https://raw.githubusercontent.com/supabase/auth/v${AUTH_VERSION}/LICENSE" licenses/supabase-auth.txt
fetch "https://raw.githubusercontent.com/axllent/mailpit/v${MAILPIT_VERSION}/LICENSE" licenses/mailpit.txt
fetch "https://raw.githubusercontent.com/PostgREST/postgrest/v${POSTGREST_VERSION}/LICENSE" licenses/postgrest.txt

sha256sum ./*.tar.* | sed 's| \./| |' > SHA256SUMS
echo "✓ Vendor refreshed. Review SHA256SUMS and commit."
