// Starts and stops the offline stack's services as detached processes that
// outlive the command, with a PID file, a log and a health check each.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type Service = {
  name: string
  health: string
  /** Files whose content the running process depends on: changing one restarts it. */
  code: string[]
  command: () => { file: string; args: string[]; env?: Record<string, string> }
}

/** Where PID files, config hashes and logs go, and the working directory. */
export type Dirs = { root: string; run: string; logs: string }

export async function isHealthy(url: string): Promise<boolean> {
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

const pidFile = (dirs: Dirs, name: string) => join(dirs.run, `${name}.pid`)
// A hash of what the service was started with: its command, environment and
// code. When any changes (a flag, NEXT_PUBLIC_APP_URL, a pull), `start` restarts it.
const configFile = (dirs: Dirs, name: string) => join(dirs.run, `${name}.config`)

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

export async function startService(service: Service, dirs: Dirs) {
  const command = service.command()
  const hash = createHash('sha256').update(JSON.stringify(command))
  for (const file of service.code) hash.update(readFileSync(file))
  const config = hash.digest('hex')
  const ours = existsSync(pidFile(dirs, service.name))
  const startedWith = existsSync(configFile(dirs, service.name))
    ? readFileSync(configFile(dirs, service.name), 'utf8')
    : undefined

  if (await isHealthy(service.health)) {
    // Something this stack did not start answers on the port: leave it alone.
    if (!ours || startedWith === config) return console.log(`✓ ${service.name} already running`)
    console.log(`→ ${service.name}: settings changed, restarting`)
  }

  stopService(service.name, dirs)
  for (let attempt = 0; attempt < 20 && (await isHealthy(service.health)); attempt += 1) {
    await sleep(250)
  }

  const logFile = join(dirs.logs, `${service.name}.log`)
  const out = openSync(logFile, 'a')
  const child = spawn(command.file, command.args, {
    cwd: dirs.root,
    detached: true,
    stdio: ['ignore', out, out],
    env: { ...process.env, ...command.env },
  })
  child.unref()
  writeFileSync(pidFile(dirs, service.name), String(child.pid))
  writeFileSync(configFile(dirs, service.name), config)

  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await isHealthy(service.health)) return console.log(`✓ ${service.name} started`)
    if (child.exitCode !== null) break
    await sleep(500)
  }
  throw new Error(
    `${service.name} did not become healthy. Last lines of ${logFile}:\n${tail(logFile)}`,
  )
}

export function stopService(name: string, dirs: Dirs) {
  const file = pidFile(dirs, name)
  if (existsSync(file)) {
    try {
      process.kill(Number(readFileSync(file, 'utf8')), 'SIGTERM')
    } catch {
      // Already gone.
    }
  }
  rmSync(file, { force: true })
  rmSync(configFile(dirs, name), { force: true })
}
