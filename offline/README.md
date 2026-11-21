# Offline stack (no Docker)

The Supabase services this project needs, run natively from binaries vendored in this folder, for machines without Docker or internet access. It stands in for `supabase start` on the same ports with the same keys, so `.env.local`, the app, the integration tests and the e2e suite run unchanged.

On a machine with Docker, use the normal stack (`pnpm bootstrap` at the repository root). Use this one only where Docker is unavailable.

## Requirements

- Linux x64
- Node 22.18+ (it runs the `.mts` scripts directly) and pnpm 11. Without pnpm: `npm install -g pnpm@11`
- PostgreSQL server binaries (`initdb`, `pg_ctl`, `postgres`). Tested with 16. No running server, root or system service needed
- Access to an npm registry or mirror for `pnpm install`

Nothing is downloaded at runtime. Auth, PostgREST and Mailpit come from `offline/vendor/`.

## Quick start

```bash
pnpm bootstrap   # no Docker: installs without install scripts, then runs `pnpm offline:start`
pnpm dev         # starts what is down, then the app on http://localhost:3000
```

Sign-up and sign-in codes land in Mailpit: http://127.0.0.1:54324.

Every command is idempotent. After a reboot, or when something stopped, run `pnpm offline:start` (or just `pnpm dev`) again. It only starts what is down.

| Command                    | What it does                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `pnpm offline:start`       | Sets up what is missing (binaries, database, migrations, `.env.local`), starts what is down |
| `pnpm offline:status`      | Shows each service; exits non-zero when any is down                                         |
| `pnpm offline:stop`        | Stops everything. Data stays in `.offline/`                                                 |
| `pnpm offline:reset --yes` | Stops everything and deletes the database and inbox                                         |

## What runs

| Service    | Address                        | Stands in for                                                                     |
| ---------- | ------------------------------ | --------------------------------------------------------------------------------- |
| Gateway    | `127.0.0.1:54321`              | Kong: `/auth/v1` → Auth, `/rest/v1` → PostgREST, `/email/*` → email templates     |
| PostgreSQL | `127.0.0.1:54322`              | The Supabase Postgres image (cluster in `.offline/pgdata`)                        |
| Mailpit    | `127.0.0.1:54324` (SMTP 54325) | The local inbox                                                                   |
| Auth       | `127.0.0.1:54330`              | Supabase Auth (GoTrue), configured like `supabase/config.toml`                    |
| PostgREST  | `127.0.0.1:54331`              | The REST API. The app never calls it; the security tests check it exposes nothing |

On the first start `bootstrap.sql` gives the plain database what the Supabase image ships: the `anon`, `authenticated`, `service_role`, `authenticator` and `supabase_auth_admin` roles, the `auth` and `extensions` schemas, `pgcrypto`, and the image's default grants. Then Auth's own migrations run, then `supabase/migrations/`, recorded in `supabase_migrations.schema_migrations` like the Supabase CLI does. Logs are in `.offline/logs/`.

## Differences from `supabase start`

- **pg_cron.** Distribution packages do not ship it. A stand-in keeps `cron.job` and `cron.schedule`, so the migrations apply, but nothing runs scheduled jobs. To purge expired account deletions, run `SELECT public.purge_expired_account_deletions();`.
- **No Studio.** Use `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres`.
- **No Google or Facebook sign-in.** They need internet. Email, password and guest accounts work.
- **Redis rate-limit tests.** `src/shared/lib/rate-limit/redis.integration.test.ts` needs the serverless-redis-http container from `docker-compose.yml`. Run the rest with `pnpm test --run --exclude src/shared/lib/rate-limit/redis.integration.test.ts`. The app itself rate-limits in memory without it.
- **Install scripts.** `pnpm bootstrap` installs with `--ignore-scripts`. The Supabase CLI's install script downloads from GitHub, and the offline stack does not use the CLI. Every other native package ships prebuilt.

## Options

| Variable               | Default                                                                                      | Use                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `OFFLINE_PG_BIN`       | Found in `/usr/lib/postgresql/<n>/bin`, `/usr/pgsql-<n>/bin`, `pg_config --bindir` or `PATH` | Folder with `initdb`, `pg_ctl` and `postgres`                                          |
| `OFFLINE_DATABASE_URL` | (unset: own cluster on port 54322)                                                           | Use a running server instead. The user must be a superuser, and the database a new one |

## Troubleshooting

- **A service does not start.** The error shows the end of its log. All logs are in `.offline/logs/`.
- **Port already in use.** Another stack holds the port, often `supabase start` itself. Stop it (`pnpm supabase:stop`) or the other program.
- **Start over.** `pnpm offline:reset --yes`, then `pnpm offline:start`.

## Updating the vendored binaries

`vendor/` holds the official Linux x64 releases of [Supabase Auth](https://github.com/supabase/auth), [PostgREST](https://github.com/PostgREST/postgrest) and [Mailpit](https://github.com/axllent/mailpit), all MIT-licensed (licenses in `vendor/licenses/`). `start` checks each archive against `vendor/SHA256SUMS` before unpacking it.

To follow a Supabase CLI upgrade, read the versions it runs (`docker ps` while `supabase start` is up), set them in `vendor/fetch.sh`, then run `bash offline/vendor/fetch.sh` on a machine with internet and commit the result. When `supabase/config.toml`'s `[auth]` settings change, mirror them in `services.mts`.
