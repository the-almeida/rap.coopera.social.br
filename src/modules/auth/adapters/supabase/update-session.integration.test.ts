import {
  combineChunks,
  createServerClient,
  stringFromBase64URL,
  stringToBase64URL,
} from '@supabase/ssr'
import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it } from 'vitest'

import { cleanupAuthUser, createTestUser, getAdminSupabase } from '@/shared/db/test-helpers'
import { env } from '@/shared/lib/env'

import { updateSession } from './update-session'

// The proxy's session refresh against the local Supabase stack. A browser is
// a cookie jar; each request to the proxy is a NextRequest built from it.

const BASE64_PREFIX = 'base64-'

type Jar = Map<string, string>

const userIds: string[] = []

afterEach(async () => {
  await Promise.all(userIds.splice(0).map((id) => cleanupAuthUser(id)))
})

function jarClient(jar: Jar) {
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) {
          if (value) jar.set(name, value)
          else jar.delete(name)
        }
      },
    },
  })
}

function storageKey(jar: Jar): string {
  const name = [...jar.keys()].find((key) => /^sb-.+-auth-token(\.\d+)?$/.test(key))
  if (!name) throw new Error('no auth cookie in the jar')
  return name.replace(/\.\d+$/, '')
}

async function readSession(jar: Jar) {
  const key = storageKey(jar)
  const raw = await combineChunks(key, (name) => jar.get(name))
  if (!raw) throw new Error('no session in the jar')
  const json = raw.startsWith(BASE64_PREFIX)
    ? stringFromBase64URL(raw.slice(BASE64_PREFIX.length))
    : raw
  return { key, session: JSON.parse(json) as { refresh_token: string; expires_at: number } }
}

// A signed-in browser: a magic link verified on the jar, so the session was
// issued by Supabase and its refresh token is real.
async function signedInJar(): Promise<Jar> {
  const user = await createTestUser({ prefix: 'proxy-refresh' })
  userIds.push(user.id)
  const { data, error } = await getAdminSupabase().auth.admin.generateLink({
    type: 'magiclink',
    email: user.email,
  })
  if (error) throw error
  const jar: Jar = new Map()
  const { error: verifyError } = await jarClient(jar).auth.verifyOtp({
    type: 'magiclink',
    token_hash: data.properties.hashed_token,
  })
  if (verifyError) throw verifyError
  return jar
}

// What the browser holds an hour later: the same refresh token, but the
// access token has expired, so the next request must refresh.
async function expireAccessToken(
  jar: Jar,
  overrides: { refresh_token?: string } = {},
): Promise<void> {
  const { key, session } = await readSession(jar)
  for (const name of [...jar.keys()]) if (name.startsWith(key)) jar.delete(name)
  const expired = { ...session, ...overrides, expires_at: Math.floor(Date.now() / 1000) - 60 }
  jar.set(key, BASE64_PREFIX + stringToBase64URL(JSON.stringify(expired)))
}

function cookiesOf(
  response: Response & { cookies: { getAll(): { name: string; value: string }[] } },
): Jar {
  return new Map(response.cookies.getAll().map(({ name, value }) => [name, value] as const))
}

// Next.js hands the page the request cookies the proxy forwards in this header.
function cookiesForwardedToPage(response: Response): Jar {
  const header = response.headers.get('x-middleware-request-cookie')
  if (!header) throw new Error('the proxy forwarded no request cookies to Next.js')
  return new Map(
    header.split(/;\s*/).map((pair) => {
      const at = pair.indexOf('=')
      return [pair.slice(0, at), decodeURIComponent(pair.slice(at + 1))] as const
    }),
  )
}

function requestFrom(jar: Jar): NextRequest {
  const cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
  return new NextRequest('http://localhost:3000/dashboard', { headers: { cookie } })
}

describe('updateSession (Supabase, local stack)', () => {
  it('sends the refreshed session cookies when the access token has expired', async () => {
    const jar = await signedInJar()
    await expireAccessToken(jar)
    const { session: before } = await readSession(jar)

    const response = await updateSession(requestFrom(jar))

    const { session: after } = await readSession(cookiesOf(response))
    expect(after.refresh_token).toMatch(/\S/)
    expect(after.refresh_token).not.toBe(before.refresh_token)
    expect(after.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })

  it('marks the response with the refreshed cookies as private and not cacheable', async () => {
    const jar = await signedInJar()
    await expireAccessToken(jar)

    const response = await updateSession(requestFrom(jar))

    const directives = response.headers.get('cache-control')?.split(/,\s*/)
    expect(directives).toEqual(expect.arrayContaining(['private', 'no-store']))
  })

  it('lets the page rendered for this request see the refreshed session', async () => {
    const jar = await signedInJar()
    await expireAccessToken(jar)
    const { session: before } = await readSession(jar)

    const response = await updateSession(requestFrom(jar))

    const { session: forPage } = await readSession(cookiesForwardedToPage(response))
    expect(forPage.refresh_token).not.toBe(before.refresh_token)
    expect(forPage.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })

  it('deletes the session cookies when the refresh token is no longer valid', async () => {
    const jar = await signedInJar()
    await expireAccessToken(jar, { refresh_token: 'unknown-refresh-token' })
    const { key } = await readSession(jar)

    const response = await updateSession(requestFrom(jar))

    expect(response.cookies.get(key)).toMatchObject({ value: '', maxAge: 0 })
  })
})
