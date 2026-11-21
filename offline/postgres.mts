// The offline stack's database: its own cluster in .offline/pgdata, run with
// the machine's PostgreSQL binaries (no root, no system service, and the
// system's server, if any, is left alone).
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import postgres from 'postgres'

import { PORTS } from './services.mts'

export type Database = { binDir: string; dataDir: string; logFile: string; url: string }

const MANAGED_URL = `postgresql://postgres:postgres@127.0.0.1:${PORTS.db}/postgres`
const TOOLS = ['initdb', 'pg_ctl', 'postgres']

function hasTools(dir: string): boolean {
  return TOOLS.every((tool) => existsSync(join(dir, tool)))
}

/** Where initdb, pg_ctl and postgres live: OFFLINE_PG_BIN, then the usual install paths, then PATH. */
function findBinDir(): string {
  const override = process.env.OFFLINE_PG_BIN
  if (override) {
    if (hasTools(override)) return override
    throw new Error(`OFFLINE_PG_BIN=${override} has no ${TOOLS.join(', ')}`)
  }

  const versioned = (base: string, pattern: RegExp, toBin: (entry: string) => string) =>
    existsSync(base)
      ? readdirSync(base)
          .filter((entry) => pattern.test(entry))
          .sort((a, b) => Number(b.match(/\d+/)?.[0]) - Number(a.match(/\d+/)?.[0]))
          .map((entry) => toBin(join(base, entry)))
      : []

  const pgConfig = spawnSync('pg_config', ['--bindir'], { encoding: 'utf8' })
  const candidates = [
    // Debian and Ubuntu: /usr/lib/postgresql/<major>/bin. Newest first.
    ...versioned('/usr/lib/postgresql', /^\d+$/, (dir) => join(dir, 'bin')),
    // RHEL and Fedora (PGDG): /usr/pgsql-<major>/bin.
    ...versioned('/usr', /^pgsql-\d+$/, (dir) => join(dir, 'bin')),
    pgConfig.status === 0 ? pgConfig.stdout.trim() : '',
    '/usr/local/pgsql/bin',
    ...(process.env.PATH ?? '').split(':'),
  ]
  const found = candidates.find((dir) => dir && hasTools(dir))
  if (!found) {
    throw new Error(
      `PostgreSQL server binaries (${TOOLS.join(', ')}) not found. ` +
        'Set OFFLINE_PG_BIN to their folder.',
    )
  }
  return found
}

export function resolveDatabase(stateDir: string): Database {
  return {
    binDir: findBinDir(),
    dataDir: join(stateDir, 'pgdata'),
    logFile: join(stateDir, 'logs', 'postgres.log'),
    url: MANAGED_URL,
  }
}

function run(binDir: string, tool: string, args: string[]) {
  return spawnSync(join(binDir, tool), args, { encoding: 'utf8' })
}

export function isDatabaseRunning(db: Database): boolean {
  return (
    existsSync(db.dataDir) && run(db.binDir, 'pg_ctl', ['status', '-D', db.dataDir]).status === 0
  )
}

/** Creates the cluster on first use and starts it when it is not running. */
export function startDatabase(db: Database): void {
  if (!existsSync(join(db.dataDir, 'PG_VERSION'))) {
    console.log(`→ Creating a PostgreSQL cluster in ${db.dataDir} (${db.binDir})`)
    // Trust on 127.0.0.1 only, like the CLI's local stack: any password works.
    const base = ['-D', db.dataDir, '-U', 'postgres', '--auth=trust', '--encoding=UTF8']
    // C.UTF-8 keeps case-insensitive matching right for accented names; older
    // systems without it fall back to the C locale.
    let init = run(db.binDir, 'initdb', [...base, '--locale=C.UTF-8'])
    if (init.status !== 0) init = run(db.binDir, 'initdb', [...base, '--no-locale'])
    if (init.status !== 0) throw new Error(`initdb failed:\n${init.stderr}`)
  }
  if (isDatabaseRunning(db)) return

  console.log(`→ Starting PostgreSQL on 127.0.0.1:${PORTS.db}`)
  const options = [
    `-p ${PORTS.db}`,
    '-c listen_addresses=127.0.0.1',
    // TCP only: no socket file, so no /var/run/postgresql permissions to fight.
    "-c unix_socket_directories=''",
    '-c max_connections=200',
  ].join(' ')
  const start = run(db.binDir, 'pg_ctl', [
    'start',
    '-w',
    '-D',
    db.dataDir,
    '-l',
    db.logFile,
    '-o',
    options,
  ])
  if (start.status !== 0) {
    throw new Error(`PostgreSQL did not start. Last lines of ${db.logFile}:\n${start.stderr}`)
  }
}

export function stopDatabase(db: Database): void {
  if (!isDatabaseRunning(db)) return
  run(db.binDir, 'pg_ctl', ['stop', '-D', db.dataDir, '-m', 'fast'])
}

const CRON_EXTENSION = /^\s*CREATE EXTENSION IF NOT EXISTS pg_cron\b[^;]*;/gim

/**
 * bootstrap.sql on a fresh database, then every file in supabase/migrations not yet applied, each in
 * its own transaction. Applied versions go to supabase_migrations.schema_migrations,
 * the table the Supabase CLI keeps, so either tool can carry on from the other.
 */
export async function applyMigrations(
  url: string,
  bootstrapFile: string,
  migrationsDir: string,
  beforeAppMigrations: () => void,
): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => {} })
  try {
    const [role] = await sql<{ rolsuper: boolean }[]>`
      SELECT rolsuper FROM pg_roles WHERE rolname = current_user`
    if (!role?.rolsuper)
      throw new Error('The database user must be a superuser (bootstrap.sql creates roles).')

    // Once, on a database no migration has touched, like the image's init
    // scripts. Running it again would hand back the default grants the
    // lockdown migration revoked.
    const [state] = await sql<{ initialized: boolean }[]>`
      SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS initialized`
    if (!state?.initialized) await sql.unsafe(readFileSync(bootstrapFile, 'utf8')).simple()
    beforeAppMigrations()

    const [cron] = await sql<{ available: boolean }[]>`
      SELECT EXISTS (SELECT FROM pg_available_extensions WHERE name = 'pg_cron') AS available`
    await sql`CREATE SCHEMA IF NOT EXISTS supabase_migrations`
    await sql`
      CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
        version text PRIMARY KEY, statements text[], name text)`
    const applied = new Set(
      (
        await sql<{ version: string }[]>`SELECT version FROM supabase_migrations.schema_migrations`
      ).map((row) => row.version),
    )

    const files = readdirSync(migrationsDir)
      .filter((file) => /^\d+_.+\.sql$/.test(file))
      .sort()
    let count = 0
    for (const file of files) {
      const version = file.slice(0, file.indexOf('_'))
      if (applied.has(version)) continue
      let content = readFileSync(join(migrationsDir, file), 'utf8')
      // Without pg_cron, bootstrap.sql's stand-in provides cron.job and friends.
      if (!cron?.available)
        content = content.replace(CRON_EXTENSION, '-- pg_cron: offline stand-in')
      await sql.begin(async (tx) => {
        await tx.unsafe(content).simple()
        await tx`
          INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
          VALUES (${version}, ${file.slice(version.length + 1, -'.sql'.length)}, ${[content]})`
      })
      count += 1
    }
    console.log(count ? `✓ Applied ${count} migration(s)` : '✓ Migrations up to date')
  } finally {
    await sql.end()
  }
}
