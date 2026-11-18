import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { GET } from './route'

// A provider sends the person back with `error` (and no code) when the
// sign-in or the link fails: denied consent, or an account already linked
// elsewhere. Each request comes from its own IP, so the callback's per-IP
// limit never mixes tests.
function callback(query: string) {
  return GET(
    new Request(`http://localhost:3000/auth/callback?${query}`, {
      headers: { 'x-forwarded-for': `test-ip-${randomUUID()}` },
    }),
  )
}

describe('OAuth callback without a code', () => {
  it('returns to the page the attempt started from, with its error', async () => {
    const response = await callback('error=access_denied&from=/account/protect')

    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/account/protect?error=oauth_failed',
    )
  })

  it('falls back to /sign-in for a page outside the allow-list', async () => {
    const response = await callback('error=access_denied&from=https://evil.example')

    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/sign-in?error=oauth_failed',
    )
  })
})
