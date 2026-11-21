# Offline stack (no Docker)

The Supabase services this project needs, run natively from binaries vendored in this folder, for machines without Docker or internet access. It stands in for `supabase start` on the same ports with the same keys, so `.env.local`, the app, the integration tests and the e2e suite run unchanged.

On a machine with Docker, use the normal stack (`pnpm bootstrap` at the repository root). Use this one only where Docker is unavailable. The commands below detect which one applies.

## Requirements

- Linux x64
- Node 22.18+ (it runs the `.mts` scripts directly)
- pnpm 11.0.0, the version `packageManager` in `package.json` pins (see below)
- PostgreSQL server binaries (`initdb`, `pg_ctl`, `postgres`). Tested with 16. No running server, root or system service needed
- An npm registry or mirror for `pnpm install`

Nothing is downloaded at runtime. Auth, PostgREST and Mailpit come from `offline/vendor/`.

## Before the first command: pnpm

Install the exact version the project pins, from the npm mirror. Without root, give npm a prefix in your home first:

```bash
npm config set prefix ~/.npm-global        # only without write access to the global prefix
export PATH="$HOME/.npm-global/bin:$PATH"  # add to ~/.bashrc to keep it
npm install -g pnpm@11.0.0
pnpm --version                             # 11.0.0
```

With any other version, pnpm tries to download 11.0.0 itself on every command, and without internet that fails. If the mirror has no 11.0.0, install the closest 11.x and tell pnpm to run anyway:

```bash
export pnpm_config_pm_on_fail=ignore       # add to ~/.bashrc to keep it
```

Keep this on the offline machine only. In the repository it would switch off the version check for everyone.

## Quick start

```bash
pnpm bootstrap   # no Docker: installs without install scripts, then starts the offline stack
pnpm dev         # starts what is down, then the app on http://localhost:3000
```

Sign-up and sign-in codes land in Mailpit: http://127.0.0.1:54324.

Every command is idempotent. After a reboot, or when something stopped, run `pnpm dev` (or `pnpm offline:start`) again. It only starts what is down, and restarts a service whose settings or code changed.

## Commands

| Command                              | What it does                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------- |
| `pnpm offline:start`                 | Sets up what is missing (binaries, database, migrations, `.env.local`), starts what is down |
| `pnpm offline:start --mock-oauth`    | The same, with the Facebook sign-in stand-in on (remembered; see below)                     |
| `pnpm offline:start --no-mock-oauth` | The same, with the stand-in off again                                                       |
| `pnpm offline:status`                | Shows each service; exits non-zero when any is down                                         |
| `pnpm offline:stop`                  | Stops everything. Data stays in `.offline/`                                                 |
| `pnpm offline:reset --yes`           | Stops everything and deletes the database and inbox                                         |

The project's usual scripts work too. Without Docker they drive the offline stack:

| Script                 | Without Docker                                                |
| ---------------------- | ------------------------------------------------------------- |
| `pnpm db:migrate`      | Applies pending migrations (`offline:start`)                  |
| `pnpm db:reset`        | A fresh database with every migration; also empties the inbox |
| `pnpm supabase:start`  | `offline:start`                                               |
| `pnpm supabase:stop`   | `offline:stop`                                                |
| `pnpm supabase:status` | `offline:status`                                              |

Running the Supabase CLI directly (`pnpm exec supabase ...`) needs Docker.

## Facebook sign-in (stand-in)

There is no internet, so no real Google or Facebook. `pnpm offline:start --mock-oauth` turns on a local stand-in for Facebook Login:

- "Continue with Facebook" (sign-in, sign-up) and "Link Facebook" (protecting a guest account) open a local page where you choose the email and name Facebook returns. Cancel works too.
- Supabase Auth runs its real Facebook flow against it: PKCE, identities, linking, and signing in again with the same email reaches the same account.
- Google stays hidden: the app shows a provider only when its client id is set, and Auth cannot be pointed away from accounts.google.com.

The setting is remembered in `.offline/settings.json`. The stand-in's client id and secret go into `.env.local` and are removed when you turn it off (real values there are never touched). Restart `pnpm dev` after switching, so the app reads the new `.env.local`.

Two tests check the repository default, no provider at all, and fail while the stand-in is on: `oauth-provider-check.integration.test.ts` and the smoke e2e "shows no OAuth buttons". Turn it off before running the suites.

## What runs

| Service    | Address                        | Stands in for                                                                             |
| ---------- | ------------------------------ | ----------------------------------------------------------------------------------------- |
| Gateway    | `127.0.0.1:54321`              | Kong: `/auth/v1` → Auth, `/rest/v1` → PostgREST, CORS, email templates, Facebook stand-in |
| PostgreSQL | `127.0.0.1:54322`              | The Supabase Postgres image (cluster in `.offline/pgdata`)                                |
| Mailpit    | `127.0.0.1:54324` (SMTP 54325) | The local inbox                                                                           |
| Auth       | `127.0.0.1:54330`              | Supabase Auth (GoTrue), configured like `supabase/config.toml`                            |
| PostgREST  | `127.0.0.1:54331`              | The REST API. The app never calls it; the security tests check it exposes nothing         |

On the first start `bootstrap.sql` gives the plain database what the Supabase image ships: the `anon`, `authenticated`, `service_role`, `authenticator` and `supabase_auth_admin` roles, the `auth` and `extensions` schemas, `pgcrypto`, and the image's default grants. Then Auth's own migrations run, then `supabase/migrations/`, recorded in `supabase_migrations.schema_migrations` like the Supabase CLI does. Logs are in `.offline/logs/`.

## Rate limiting: no Redis needed

Upstash Redis is the production backend, on Vercel only: serverless runs many instances at once, and they must share one count. Locally and offline the app is one Node process on one machine, so it needs no Redis and nothing reaches the internet. With `KV_REST_API_URL` and `KV_REST_API_TOKEN` empty, as here, it counts in memory: every limit applies as in production (sign-in, sign-up, guest access, battle-night actions, the public API), and one contract suite checks both backends (`src/shared/lib/rate-limit/contract.test-helper.ts`, run by `memory.test.ts` and `redis.integration.test.ts`). Counts start over when the app restarts. The startup warning "not safe for multi-instance production" is about Vercel, not about this machine.

## Differences from `supabase start`

- **pg_cron.** Distribution packages do not ship it. A stand-in keeps `cron.job` and `cron.schedule`, so the migrations apply, but nothing runs scheduled jobs. To purge expired account deletions, run `SELECT public.purge_expired_account_deletions();`.
- **No Studio.** Use `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres`.
- **No Google sign-in; Facebook only through the stand-in** (above). Email, password and guest accounts work as usual.
- **Redis rate-limit tests.** `src/shared/lib/rate-limit/redis.integration.test.ts` needs the serverless-redis-http container from `docker-compose.yml`. Run the rest with `pnpm test --run --exclude src/shared/lib/rate-limit/redis.integration.test.ts`. The app itself rate-limits in memory without it.
- **Install scripts.** `pnpm bootstrap` installs with `--ignore-scripts`. The Supabase CLI's install script downloads from GitHub, and the offline stack does not use the CLI. Every other native package ships prebuilt.

## Environment variables

Set them in the shell (or `~/.bashrc`) before the commands. They are read on every run, not saved.

| Variable         | Default                                                                                      | Use                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `OFFLINE_PG_BIN` | Found in `/usr/lib/postgresql/<n>/bin`, `/usr/pgsql-<n>/bin`, `pg_config --bindir` or `PATH` | Folder with `initdb`, `pg_ctl` and `postgres`, when they live somewhere else |

## Troubleshooting

- **Every pnpm command fails before running.** pnpm is trying to fetch the pinned version: see "Before the first command".
- **`pnpm install` cannot find a package version.** The mirror lacks a version the lockfile pins. Ask whoever runs the mirror to add it; installing without the lockfile would test different code than CI does.
- **A service does not start.** The error shows the end of its log. All logs are in `.offline/logs/`.
- **Port already in use.** Another stack holds the port, often `supabase start` itself. Stop it or the other program.
- **Start over.** `pnpm offline:reset --yes`, then `pnpm offline:start`.

## Updating the vendored binaries

`vendor/` holds the official Linux x64 releases of [Supabase Auth](https://github.com/supabase/auth), [PostgREST](https://github.com/PostgREST/postgrest) and [Mailpit](https://github.com/axllent/mailpit), all MIT-licensed (licenses in `vendor/licenses/`). `start` checks each archive against `vendor/SHA256SUMS` before unpacking it.

To follow a Supabase CLI upgrade, read the versions it runs (`docker ps` while `supabase start` is up), set them in `vendor/fetch.sh`, then run `bash offline/vendor/fetch.sh` on a machine with internet and commit the result. When `supabase/config.toml`'s `[auth]` settings change, mirror them in `services.mts`.
