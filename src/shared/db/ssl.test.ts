import { describe, expect, it } from 'vitest'

import { resolveSsl } from './ssl'

describe('resolveSsl', () => {
  it.each([
    'postgresql://postgres.abcdefghijkl:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres',
    'postgresql://postgres:pw@db.abcdefghijkl.supabase.co:5432/postgres',
  ])('encrypts the connection to a remote host whose URL names no sslmode: %s', (url) => {
    expect(resolveSsl(url)).toBe('require')
  })

  it.each([
    'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    'postgresql://postgres:postgres@localhost:54322/postgres',
    'postgresql://postgres:postgres@[::1]:54322/postgres',
  ])('leaves the connection to a loopback host unencrypted: %s', (url) => {
    expect(resolveSsl(url)).toBe(false)
  })

  it.each([
    'postgresql://postgres:pw@db.abcdefghijkl.supabase.co:5432/postgres?sslmode=verify-full',
    'postgresql://postgres:pw@db.abcdefghijkl.supabase.co:5432/postgres?sslrootcert=system',
    'postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=require',
  ])('leaves the choice to an sslmode or sslrootcert named in the URL: %s', (url) => {
    expect(resolveSsl(url)).toBeUndefined()
  })
})
