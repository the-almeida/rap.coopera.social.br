// The Supabase stack without Docker: PostgreSQL, Supabase Auth, PostgREST,
// Mailpit and a gateway, on the ports `supabase start` uses. See offline/README.md.
//
//   node offline/stack.mts start    sets up what is missing, starts what is down
//     --mock-oauth / --no-mock-oauth  turn the Facebook Login stand-in on or off (remembered)
//   node offline/stack.mts status   what is up
//   node offline/stack.mts stop     stops everything (data is kept)
//   node offline/stack.mts reset --yes   stops and deletes the database and inbox
//
// Every command is idempotent: run `start` again after a reboot or a pause.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import {
  applyMigrations,
  isDatabaseRunning,
  resolveDatabase,
  startDatabase,
  stopDatabase,
} from './postgres.mts'
import {
  API_URL,
  authEnv,
  type AuthOptions,
  databaseUrls,
  DEFAULT_SITE_URL,
  mailpitArgs,
  PORTS,
  restEnv,
} from './services.mts'
import { type Dirs, isHealthy, type Service, startService, stopService } from './processes.mts'
import { loadSettings, readSiteUrl, writeEnvFile } from './settings.mts'

const ROOT = resolve(import.meta.dirname, '..')
const VENDOR = join(ROOT, 'offline', 'vendor')
const STATE = join(ROOT, '.offline')
const BIN = join(STATE, 'bin')
const RUN = join(STATE, 'run')
const LOGS = join(STATE, 'logs')

const DIRS: Dirs = { root: ROOT, run: RUN, logs: LOGS }

// status and stop only need names and health checks, not each service's settings.
const ANY_AUTH_OPTIONS: AuthOptions = { siteUrl: DEFAULT_SITE_URL, mockFacebook: false }

function services(urls: ReturnType<typeof databaseUrls>, authOptions: AuthOptions): Service[] {
  // The vendored binaries change only with SHA256SUMS; the gateway is our own code.
  const binaries = [join(VENDOR, 'SHA256SUMS')]
  const gatewayCode = ['gateway.mts', 'mock-facebook.mts', 'services.mts'].map((file) =>
    join(ROOT, 'offline', file),
  )
  return [
    {
      name: 'mailpit',
      code: binaries,
      health: `http://127.0.0.1:${PORTS.mailpit}/api/v1/info`,
      command: () => ({
        file: join(BIN, 'mailpit', 'mailpit'),
        args: mailpitArgs(join(STATE, 'mailpit.db')),
      }),
    },
    {
      name: 'auth',
      code: binaries,
      health: `http://127.0.0.1:${PORTS.auth}/health`,
      command: () => ({
        file: join(BIN, 'auth', 'auth'),
        args: ['serve'],
        env: authEnv(urls.auth, join(BIN, 'auth', 'migrations'), authOptions),
      }),
    },
    {
      name: 'rest',
      code: binaries,
      health: `http://127.0.0.1:${PORTS.rest}/`,
      command: () => ({
        file: join(BIN, 'postgrest', 'postgrest'),
        args: [],
        env: restEnv(urls.rest),
      }),
    },
    {
      name: 'gateway',
      code: gatewayCode,
      health: `${API_URL}/health`,
      command: () => ({
        file: process.execPath,
        args: [
          join(ROOT, 'offline', 'gateway.mts'),
          String(PORTS.gateway),
          String(PORTS.auth),
          String(PORTS.rest),
          join(ROOT, 'supabase', 'templates'),
        ],
      }),
    },
  ]
}

function preflight() {
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw new Error(
      `The vendored binaries are for Linux x64; this is ${process.platform} ${process.arch}.`,
    )
  }
}

/** Verifies each vendored archive against SHA256SUMS and unpacks it into .offline/bin, once per version. */
function extractVendor() {
  const sums = readFileSync(join(VENDOR, 'SHA256SUMS'), 'utf8')
  const stamp = join(BIN, '.sha256sums')
  if (existsSync(stamp) && readFileSync(stamp, 'utf8') === sums) return

  console.log('→ Unpacking vendored binaries')
  rmSync(BIN, { recursive: true, force: true })
  const targets: Record<string, string[]> = {
    auth: ['auth'],
    mailpit: ['mailpit'],
    postgrest: ['postgrest'],
  }
  for (const line of sums.trim().split('\n')) {
    const [expected, file] = line.trim().split(/\s+/)
    if (!expected || !file) continue
    const name = Object.keys(targets).find((key) => file.startsWith(`${key}-`))
    if (!name) throw new Error(`SHA256SUMS lists ${file}, which no service uses`)

    const archive = join(VENDOR, file)
    const actual = createHash('sha256').update(readFileSync(archive)).digest('hex')
    if (actual !== expected)
      throw new Error(`${file}: checksum mismatch, the archive is corrupt or was changed`)

    const dir = join(BIN, name)
    mkdirSync(dir, { recursive: true })
    // tar needs xz for .tar.xz; Python's tarfile unpacks it when xz is missing.
    const tar = spawnSync('tar', ['-xf', archive, '-C', dir])
    if (tar.status !== 0) {
      const py = spawnSync('python3', [
        '-c',
        'import sys,tarfile; tarfile.open(sys.argv[1]).extractall(sys.argv[2])',
        archive,
        dir,
      ])
      if (py.status !== 0) throw new Error(`Could not unpack ${file} with tar or python3`)
    }
    // Zip uploads and some copies drop the executable bit, so set it here.
    for (const binary of targets[name]!) chmodSync(join(dir, binary), 0o755)
  }
  writeFileSync(stamp, sums)
}

async function start() {
  preflight()
  for (const dir of [BIN, RUN, LOGS]) mkdirSync(dir, { recursive: true })
  extractVendor()

  const settings = loadSettings(STATE, process.argv)
  const authOptions: AuthOptions = { siteUrl: readSiteUrl(ROOT), mockFacebook: settings.mockOAuth }

  const db = resolveDatabase(STATE)
  startDatabase(db)
  const urls = databaseUrls(db.url)

  await applyMigrations(
    urls.admin,
    join(ROOT, 'offline', 'bootstrap.sql'),
    join(ROOT, 'supabase', 'migrations'),
    () => {
      // Auth's own migrations create the auth schema's tables, which ours reference.
      const migrate = spawnSync(join(BIN, 'auth', 'auth'), ['migrate'], {
        env: {
          ...process.env,
          ...authEnv(urls.auth, join(BIN, 'auth', 'migrations'), authOptions),
        },
        encoding: 'utf8',
      })
      if (migrate.status !== 0)
        throw new Error(`Auth migrations failed:\n${migrate.stderr || migrate.stdout}`)
    },
  )
  writeEnvFile(ROOT, urls.admin, settings)

  for (const service of services(urls, authOptions)) await startService(service, DIRS)

  console.log(`
Offline stack is up.
  API (Auth, REST)  ${API_URL}
  Database          ${urls.admin}
  Mailpit (inbox)   http://127.0.0.1:${PORTS.mailpit}
  Logs              ${LOGS}
  Facebook sign-in  ${settings.mockOAuth ? 'offline stand-in (--no-mock-oauth turns it off)' : 'off (--mock-oauth turns on a stand-in)'}
Next: pnpm dev (or pnpm build && pnpm start)`)
}

async function status() {
  const db = resolveDatabase(STATE)
  const dbUp = isDatabaseRunning(db)
  console.log(`${dbUp ? '✓' : '✗'} postgres`)
  let allUp = dbUp
  for (const service of services(databaseUrls(db.url), ANY_AUTH_OPTIONS)) {
    const up = await isHealthy(service.health)
    allUp &&= up
    console.log(`${up ? '✓' : '✗'} ${service.name}`)
  }
  if (!allUp) process.exitCode = 1
}

function stop() {
  const db = resolveDatabase(STATE)
  for (const service of services(databaseUrls(db.url), ANY_AUTH_OPTIONS).reverse()) {
    stopService(service.name, DIRS)
  }
  stopDatabase(db)
  console.log('✓ Offline stack stopped (data kept in .offline/)')
}

function reset() {
  if (!process.argv.includes('--yes')) {
    throw new Error('reset deletes the offline database and inbox. Run it with --yes to confirm.')
  }
  const db = resolveDatabase(STATE)
  stop()
  rmSync(db.dataDir, { recursive: true, force: true })
  rmSync(join(STATE, 'mailpit.db'), { force: true })
  console.log('✓ Database and inbox deleted. `start` creates them again.')
}

const commands: Record<string, () => unknown> = { start, status, stop, reset }
const command = commands[process.argv[2] ?? '']
if (!command) {
  console.error('usage: node offline/stack.mts <start|status|stop|reset --yes>')
  process.exit(1)
}
try {
  await command()
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
