// What the offline stack remembers between commands, and the `.env.local` it
// keeps in step with the running services.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  ANON_KEY,
  API_URL,
  DEFAULT_SITE_URL,
  MOCK_FACEBOOK,
  SERVICE_ROLE_KEY,
} from './services.mts'

export type Settings = { mockOAuth: boolean }

/**
 * Settings from .offline/settings.json, changed by `--mock-oauth` /
 * `--no-mock-oauth` on the command line. Saved, so a later `pnpm dev` or a
 * restart after a pause brings back the same stack.
 */
export function loadSettings(stateDir: string, argv: string[]): Settings {
  const file = join(stateDir, 'settings.json')
  const saved: Partial<Settings> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
  const settings: Settings = { mockOAuth: saved.mockOAuth ?? false }
  if (argv.includes('--mock-oauth')) settings.mockOAuth = true
  if (argv.includes('--no-mock-oauth')) settings.mockOAuth = false
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`)
  return settings
}

function envPath(root: string) {
  return join(root, '.env.local')
}

/** NEXT_PUBLIC_APP_URL from .env.local: where Auth sends people back after sign-in. */
export function readSiteUrl(root: string): string {
  const file = envPath(root)
  if (!existsSync(file)) return DEFAULT_SITE_URL
  const value = readFileSync(file, 'utf8')
    .match(/^NEXT_PUBLIC_APP_URL=(.*)$/m)?.[1]
    ?.trim()
  return value ? value.replace(/\/+$/, '') : DEFAULT_SITE_URL
}

/**
 * The values `pnpm bootstrap` writes from `supabase status`, plus the Facebook
 * stand-in's client id and secret while it is on. The app shows a provider's
 * button only when its client id is set, so Google stays hidden. Turning the
 * stand-in off clears only its own values, never real ones.
 */
export function writeEnvFile(root: string, databaseUrl: string, settings: Settings) {
  const file = envPath(root)
  const original = readFileSync(existsSync(file) ? file : join(root, '.env.example'), 'utf8')
  const values: Record<string, string | undefined> = {
    NEXT_PUBLIC_SUPABASE_URL: API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
    DATABASE_URL: databaseUrl,
  }
  const mock = {
    FACEBOOK_OAUTH_CLIENT_ID: MOCK_FACEBOOK.clientId,
    FACEBOOK_OAUTH_CLIENT_SECRET: MOCK_FACEBOOK.secret,
  }
  for (const [key, value] of Object.entries(mock)) {
    const current = original.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]
    if (settings.mockOAuth) values[key] = value
    else if (current === value) values[key] = ''
  }

  let content = original
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue
    const line = new RegExp(`^${key}=.*$`, 'm')
    content = line.test(content)
      ? content.replace(line, `${key}=${value}`)
      : `${content.trimEnd()}\n${key}=${value}\n`
  }
  if (existsSync(file) && content === original) return
  writeFileSync(file, content)
  console.log('✓ .env.local written with the offline stack values')
}
