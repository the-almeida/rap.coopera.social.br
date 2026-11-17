import { describe, expect, it } from 'vitest'

import { createQueryClient } from './query-client'

// postgres.js opens no connection until the first query, so `options` shows
// the TLS mode the client would use without touching a database.
const sslOf = (databaseUrl: string) => createQueryClient(databaseUrl).options.ssl

const REMOTE =
  'postgresql://postgres.abcdefghijkl:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres'

describe('createQueryClient', () => {
  it('requires TLS to a remote host whose URL names no sslmode', () => {
    expect(sslOf(REMOTE)).toBe('require')
  })

  it('verifies the server certificate when the URL asks for verify-full', () => {
    expect(sslOf(`${REMOTE}?sslmode=verify-full`)).toBe('verify-full')
  })

  it('connects without TLS to a remote host when the URL opts out with sslmode=disable', () => {
    expect(sslOf(`${REMOTE}?sslmode=disable`)).toBe(false)
  })
})
