import { describe, expect, it } from 'vitest'

import { parseServerEnv } from './index'

// The smallest server environment that validates; each test adds to it.
const required = {
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
}

describe('parseServerEnv: rate-limit Redis credentials', () => {
  it('accepts neither KV variable (in-memory rate limiting)', () => {
    expect(parseServerEnv(required).success).toBe(true)
  })

  it('accepts both KV variables together', () => {
    const parsed = parseServerEnv({
      ...required,
      KV_REST_API_URL: 'https://example.upstash.io',
      KV_REST_API_TOKEN: 'token',
    })

    expect(parsed.success).toBe(true)
  })

  it('rejects a URL without a token and names the missing variable', () => {
    const parsed = parseServerEnv({ ...required, KV_REST_API_URL: 'https://example.upstash.io' })

    expect(parsed.success).toBe(false)
    expect(parsed.error?.flatten().fieldErrors).toHaveProperty('KV_REST_API_TOKEN')
  })

  it('rejects a token without a URL and names the missing variable', () => {
    const parsed = parseServerEnv({ ...required, KV_REST_API_TOKEN: 'token' })

    expect(parsed.success).toBe(false)
    expect(parsed.error?.flatten().fieldErrors).toHaveProperty('KV_REST_API_URL')
  })

  it('treats a blank value as missing', () => {
    const parsed = parseServerEnv({
      ...required,
      KV_REST_API_URL: 'https://example.upstash.io',
      KV_REST_API_TOKEN: '  ',
    })

    expect(parsed.success).toBe(false)
    expect(parsed.error?.flatten().fieldErrors).toHaveProperty('KV_REST_API_TOKEN')
  })
})

describe('parseServerEnv: Turnstile keys', () => {
  it.each([
    [
      'a site key without a secret',
      { NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'site' },
      'TURNSTILE_SECRET_KEY',
    ],
    [
      'a secret without a site key',
      { TURNSTILE_SECRET_KEY: 'secret' },
      'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
    ],
  ])('rejects %s and names the missing one', (_label, keys, missing) => {
    // A widget nothing checks, or a check no widget can pass.
    const parsed = parseServerEnv({ ...required, ...keys })

    expect(parsed.success).toBe(false)
    expect(parsed.error?.flatten().fieldErrors).toHaveProperty(missing)
  })

  it('accepts both keys together, or neither', () => {
    const both = { NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'site', TURNSTILE_SECRET_KEY: 'secret' }

    expect(parseServerEnv({ ...required, ...both }).success).toBe(true)
    expect(parseServerEnv(required).success).toBe(true)
  })
})
