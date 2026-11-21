// The Supabase stack without Docker: PostgreSQL, Supabase Auth, PostgREST,
// Mailpit and a gateway, on the ports `supabase start` uses. See offline/README.md.
//
//   node offline/stack.mts start    sets up what is missing, starts what is down
//   node offline/stack.mts status   what is up
//   node offline/stack.mts stop     stops everything (data is kept)
//   node offline/stack.mts reset --yes   stops and deletes the database and inbox
//
// Every command is idempotent: run `start` again after a reboot or a pause.
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'

import {
  applyMigrations,
  isManagedRunning,
  resolveDatabase,
  startManaged,
  stopManaged,
} from './postgres.mts'
import {
  ANON_KEY,
  API_URL,
  authEnv,
  databaseUrls,
  mailpitArgs,
  PORTS,
  restEnv,
  SERVICE_ROLE_KEY,
} from './services.mts'

const ROOT = resolve(import.meta.dirname, '..')
const VENDOR = join(ROOT, 'offline', 'vendor')
const STATE = join(ROOT, '.offline')
const BIN = join(STATE, 'bin')
const RUN = join(STATE, 'run')
const LOGS = join(STATE, 'logs')

type Service = {
  name: string
  health: string
  command: () => { file: string; args: string[]; env?: Record<string, string> }
}

function services(urls: ReturnType<typeof databaseUrls>): Service[] {
  return [
    {
      name: 'mailpit',
      health: `http://127.0.0.1:${PORTS.mailpit}/api/v1/info`,
      command: () => ({
        file: join(BIN, 'mailpit', 'mailpit'),
        args: mailpitArgs(join(STATE, 'mailpit.db')),
      }),
    },
    {
      name: 'auth',
      health: `http://127.0.0.1:${PORTS.auth}/health`,
      command: () => ({
        file: join(BIN, 'auth', 'auth'),
        args: ['serve'],
        env: authEnv(urls.auth, join(BIN, 'auth', 'migrations')),
      }),
    },
    {
      name: 'rest',
      health: `http://127.0.0.1:${PORTS.rest}/`,
      command: () => ({
        file: join(BIN, 'postgrest', 'postgrest'),
        args: [],
        env: restEnv(urls.rest),
      }),
    },
    {
      name: 'gateway',
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

async function isHealthy(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000) })
    return response.status < 500
  } catch {
    return false
  }
}

function tail(file: string, lines = 20): string {
  if (!existsSync(file)) return '(no log)'
  return readFileSync(file, 'utf8').trimEnd().split('\n').slice(-lines).join('\n')
}

function pidFile(name: string) {
  return join(RUN, `${name}.pid`)
}

async function startService(service: Service) {
  if (await isHealthy(service.health)) return console.log(`✓ ${service.name} already running`)

  stopService(service.name)
  const { file, args, env } = service.command()
  const logFile = join(LOGS, `${service.name}.log`)
  const out = openSync(logFile, 'a')
  const child = spawn(file, args, {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', out, out],
    env: { ...process.env, ...env },
  })
  child.unref()
  writeFileSync(pidFile(service.name), String(child.pid))

  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await isHealthy(service.health)) return console.log(`✓ ${service.name} started`)
    if (child.exitCode !== null) break
    await new Promise((done) => setTimeout(done, 500))
  }
  throw new Error(
    `${service.name} did not become healthy. Last lines of ${logFile}:\n${tail(logFile)}`,
  )
}

function stopService(name: string) {
  const file = pidFile(name)
  if (!existsSync(file)) return
  const pid = Number(readFileSync(file, 'utf8'))
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    // Already gone.
  }
  rmSync(file, { force: true })
}

/** The same values `pnpm bootstrap` writes from `supabase status`. */
function writeEnvFile(databaseUrl: string) {
  const envFile = join(ROOT, '.env.local')
  const values: Record<string, string> = {
    NEXT_PUBLIC_SUPABASE_URL: API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
    DATABASE_URL: databaseUrl,
  }
  const original = readFileSync(existsSync(envFile) ? envFile : join(ROOT, '.env.example'), 'utf8')
  let content = original
  for (const [key, value] of Object.entries(values)) {
    const line = new RegExp(`^${key}=.*$`, 'm')
    content = line.test(content)
      ? content.replace(line, `${key}=${value}`)
      : `${content}\n${key}=${value}\n`
  }
  if (existsSync(envFile) && content === original) return
  writeFileSync(envFile, content)
  console.log('✓ .env.local written with the offline stack values')
}

async function start() {
  preflight()
  for (const dir of [BIN, RUN, LOGS]) mkdirSync(dir, { recursive: true })
  extractVendor()

  const db = resolveDatabase(STATE)
  if (db.kind === 'managed') startManaged(db)
  const urls = databaseUrls(db.url)

  await applyMigrations(
    urls.admin,
    join(ROOT, 'offline', 'bootstrap.sql'),
    join(ROOT, 'supabase', 'migrations'),
    () => {
      // Auth's own migrations create the auth schema's tables, which ours reference.
      const migrate = spawnSync(join(BIN, 'auth', 'auth'), ['migrate'], {
        env: { ...process.env, ...authEnv(urls.auth, join(BIN, 'auth', 'migrations')) },
        encoding: 'utf8',
      })
      if (migrate.status !== 0)
        throw new Error(`Auth migrations failed:\n${migrate.stderr || migrate.stdout}`)
    },
  )
  writeEnvFile(urls.admin)

  for (const service of services(urls)) await startService(service)

  console.log(`
Offline stack is up.
  API (Auth, REST)  ${API_URL}
  Database          ${urls.admin}
  Mailpit (inbox)   http://127.0.0.1:${PORTS.mailpit}
  Logs              ${LOGS}
Next: pnpm dev (or pnpm build && pnpm start)`)
}

async function status() {
  const db = resolveDatabase(STATE)
  const dbUp = db.kind === 'managed' ? isManagedRunning(db) : true
  console.log(`${dbUp ? '✓' : '✗'} postgres (${db.kind})`)
  let allUp = dbUp
  for (const service of services(databaseUrls(db.url))) {
    const up = await isHealthy(service.health)
    allUp &&= up
    console.log(`${up ? '✓' : '✗'} ${service.name}`)
  }
  if (!allUp) process.exitCode = 1
}

function stop() {
  const db = resolveDatabase(STATE)
  for (const service of services(databaseUrls(db.url)).reverse()) stopService(service.name)
  if (db.kind === 'managed') stopManaged(db)
  console.log('✓ Offline stack stopped (data kept in .offline/)')
}

function reset() {
  if (!process.argv.includes('--yes')) {
    throw new Error('reset deletes the offline database and inbox. Run it with --yes to confirm.')
  }
  const db = resolveDatabase(STATE)
  if (db.kind === 'external')
    throw new Error('reset only deletes the managed cluster; drop the external database yourself.')
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
