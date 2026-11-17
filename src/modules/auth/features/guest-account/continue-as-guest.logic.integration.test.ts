import { randomUUID } from 'node:crypto'

import { createServerClient } from '@supabase/ssr'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { db } from '@/shared/db/client'
import { users } from '@/shared/db/schema/auth'
import {
  cleanupAuthUser,
  createAnonSupabase,
  createTestUser,
  getAdminSupabase,
  markPasswordVerified,
} from '@/shared/db/test-helpers'
import { env } from '@/shared/lib/env'
import { ExternalServiceError } from '@/shared/lib/errors/base'
import { err } from '@/shared/lib/result'
import { logger } from '@/shared/observability/logger'

import { createFakeAuth } from '../../adapters/auth-provider.fake.test-helper'
import { createSupabaseAuthProvider } from '../../adapters/auth-provider.supabase'
import { userRepository } from '../../adapters/user-repository.drizzle'
import { guestEmailFromNickname } from '../../domain/guest'
import { AUTH_ERROR_MESSAGES } from '../../ports/auth-provider'

import { continueAsGuestWith, NICKNAME_TAKEN_MESSAGE } from './continue-as-guest.logic'

// "Continue as guest" against the local Supabase and database: the guest
// account's row comes from the auth trigger, and its password only opens a
// session once it is recorded as verified (the token hook). Each browser is
// a cookie jar.

const PASSWORD = 'correct-horse-1'

const nicknames: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const nickname of nicknames.splice(0)) {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, guestEmailFromNickname(nickname)))
    for (const row of rows) await cleanupAuthUser(row.id)
  }
})

function newNickname() {
  const nickname = `guest_${randomUUID().replaceAll('-', '').slice(0, 12)}`
  nicknames.push(nickname)
  return nickname
}

function browser() {
  const jar = new Map<string, string>()
  const client = () =>
    createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
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
  return createSupabaseAuthProvider(async () => client())
}

const deps = (authProvider = browser(), ip = `test-ip-${randomUUID()}`) => ({ authProvider, ip })

async function guestRows(nickname: string) {
  return db
    .select()
    .from(users)
    .where(eq(users.email, guestEmailFromNickname(nickname)))
}

describe('continue as guest', () => {
  it('creates the account for a new nickname and signs it in, in one step', async () => {
    const nickname = newNickname()
    const authProvider = browser()

    const result = await continueAsGuestWith(deps(authProvider), { nickname, password: PASSWORD })

    expect(result).toEqual({ ok: true, value: { status: 'created' } })
    const [row] = await guestRows(nickname)
    expect(row).toMatchObject({ name: nickname, guestNickname: nickname })
    expect(row?.passwordVerifiedAt).toBeInstanceOf(Date)
    expect(await authProvider.getCurrentIdentity()).toMatchObject({ userId: row?.id })
  })

  it('signs a returning nickname in with its password, creating nothing', async () => {
    const nickname = newNickname()
    await continueAsGuestWith(deps(), { nickname, password: PASSWORD })
    const authProvider = browser()
    const create = vi.spyOn(authProvider, 'createGuestUser')

    const result = await continueAsGuestWith(deps(authProvider), { nickname, password: PASSWORD })

    expect(result).toEqual({ ok: true, value: { status: 'signed-in' } })
    expect(create).not.toHaveBeenCalled()
    const [row] = await guestRows(nickname)
    expect(await authProvider.getCurrentIdentity()).toMatchObject({ userId: row?.id })
  })

  it('answers a taken nickname with a wrong password clearly, creating no second account', async () => {
    const nickname = newNickname()
    await continueAsGuestWith(deps(), { nickname, password: PASSWORD })
    const authProvider = browser()
    const create = vi.spyOn(authProvider, 'createGuestUser')

    const result = await continueAsGuestWith(deps(authProvider), {
      nickname,
      password: 'not-the-password',
    })

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'UNAUTHENTICATED', message: NICKNAME_TAKEN_MESSAGE }),
    })
    expect(create).not.toHaveBeenCalled()
  })

  it('answers a nickname whose password is not trusted like a wrong password', async () => {
    const nickname = newNickname()
    await continueAsGuestWith(deps(), { nickname, password: PASSWORD })
    await db
      .update(users)
      .set({ passwordVerifiedAt: null })
      .where(eq(users.guestNickname, nickname))

    const result = await continueAsGuestWith(deps(), { nickname, password: PASSWORD })

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'UNAUTHENTICATED', message: NICKNAME_TAKEN_MESSAGE }),
    })
  })

  it('answers "taken" when the nickname was created between the lookup and the create', async () => {
    const nickname = newNickname()
    // Another request created the account but has not reserved the nickname yet.
    const { error } = await getAdminSupabase().auth.admin.createUser({
      email: guestEmailFromNickname(nickname),
      password: 'someone-elses-password',
      email_confirm: true,
      user_metadata: { name: nickname },
      app_metadata: { guest: true },
    })
    if (error) throw error

    const result = await continueAsGuestWith(deps(), { nickname, password: PASSWORD })

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'UNAUTHENTICATED', message: NICKNAME_TAKEN_MESSAGE }),
    })
  })

  it('deletes the account again when its set-up fails halfway, freeing the nickname', async () => {
    const nickname = newNickname()
    // @wc-test-auditor-allow: internal-mock — fault injection at the database edge: completeGuestSetup is one UPDATE with no logic, no real input makes it fail (a colliding nickname is caught by findByGuestNickname first), and the clean-up under test is checked on real Supabase and database state
    vi.spyOn(userRepository, 'completeGuestSetup').mockRejectedValueOnce(new Error('database down'))

    await expect(continueAsGuestWith(deps(), { nickname, password: PASSWORD })).rejects.toThrow(
      'database down',
    )

    expect(await guestRows(nickname)).toHaveLength(0)
  })

  it.each([
    [
      'answers with an error',
      () => err(new ExternalServiceError('supabase', AUTH_ERROR_MESSAGES.unavailable)),
    ],
    ['throws', () => Promise.reject(new Error('admin down'))],
  ])('reports a clean-up that %s, and still surfaces the first error', async (_label, deletion) => {
    const nickname = newNickname()
    const authProvider = browser()
    // @wc-test-auditor-allow: internal-mock — fault injection at the database edge, as in the test above: no real input makes this single UPDATE fail
    vi.spyOn(userRepository, 'completeGuestSetup').mockRejectedValueOnce(new Error('database down'))
    vi.spyOn(authProvider, 'deleteUser').mockImplementationOnce(async () => deletion())
    const logged = vi.spyOn(logger, 'error').mockImplementation(() => undefined)

    await expect(
      continueAsGuestWith(deps(authProvider), { nickname, password: PASSWORD }),
    ).rejects.toThrow('database down')

    // The account stays (the deletion failed); the log names it, not the nickname.
    const [row] = await guestRows(nickname)
    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'guest-account', userId: row?.id }),
      expect.stringContaining('could not be deleted'),
    )
    expect(JSON.stringify(logged.mock.calls)).not.toContain(nickname)
  })

  it('refuses the 11th attempt on one nickname within a minute, even with the right password', async () => {
    const nickname = newNickname()
    await continueAsGuestWith(deps(), { nickname, password: PASSWORD })
    for (let attempt = 0; attempt < 8; attempt++) {
      await continueAsGuestWith(deps(), { nickname, password: 'not-the-password' })
    }
    const tenth = await continueAsGuestWith(deps(), { nickname, password: 'not-the-password' })
    expect(tenth).toEqual({
      ok: false,
      error: expect.objectContaining({ message: NICKNAME_TAKEN_MESSAGE }),
    })

    const result = await continueAsGuestWith(deps(), { nickname, password: PASSWORD })

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'RATE_LIMIT_EXCEEDED' }),
    })
  })

  it('creates at most 10 accounts a minute from one IP, refusing before creating', async () => {
    // The fake stands in for Supabase: eleven real accounts would spend the
    // local Supabase's own per-IP budget that the whole suite shares. Under the
    // fake each creation ends at the sign-in (the fake has no database row to
    // trust the password in); only the count of creations matters here.
    const authProvider = createFakeAuth().newSession()
    const create = vi.spyOn(authProvider, 'createGuestUser')
    const ip = `test-ip-${randomUUID()}`
    for (let account = 0; account < 10; account++) {
      await continueAsGuestWith(
        { authProvider, ip },
        { nickname: newNickname(), password: PASSWORD },
      )
    }

    const result = await continueAsGuestWith(
      { authProvider, ip },
      { nickname: newNickname(), password: PASSWORD },
    )

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'RATE_LIMIT_EXCEEDED' }),
    })
    expect(create).toHaveBeenCalledTimes(10)
  })

  it('passes a provider outage through instead of calling it a wrong password', async () => {
    const nickname = newNickname()
    await continueAsGuestWith(deps(), { nickname, password: PASSWORD })
    const authProvider = browser()
    const outage = new ExternalServiceError('supabase', AUTH_ERROR_MESSAGES.unavailable)
    vi.spyOn(authProvider, 'signInWithPassword').mockResolvedValue(err(outage))

    const result = await continueAsGuestWith(deps(authProvider), { nickname, password: PASSWORD })

    expect(result).toEqual({ ok: false, error: outage })
  })

  it('keeps a nickname free when someone tries its address through Supabase directly', async () => {
    const nickname = newNickname()

    const direct = await createAnonSupabase().auth.signUp({
      email: guestEmailFromNickname(nickname),
      password: 'squatter-password-1',
      options: { data: { name: nickname } },
    })

    // The database refuses the row: Supabase answers 500, not a rate limit.
    expect(direct.error).toMatchObject({ status: 500 })
    expect(await continueAsGuestWith(deps(), { nickname, password: PASSWORD })).toEqual({
      ok: true,
      value: { status: 'created' },
    })
  })

  it('refuses to move an account to a guest address, keeping the nickname free', async () => {
    const nickname = newNickname()
    const owner = await createTestUser({ prefix: 'email-change' })
    const password = 'owner-password-1'
    await getAdminSupabase().auth.admin.updateUserById(owner.id, { password })
    // Setting the password above leaves it untrusted; an ordinary account's is.
    await markPasswordVerified(owner.id)
    const client = createAnonSupabase()
    const signedIn = await client.auth.signInWithPassword({ email: owner.email, password })
    if (signedIn.error) throw signedIn.error

    const change = await client.auth.updateUser({ email: guestEmailFromNickname(nickname) })

    try {
      expect(change.error).toMatchObject({ status: 500 })
      expect(await continueAsGuestWith(deps(), { nickname, password: PASSWORD })).toEqual({
        ok: true,
        value: { status: 'created' },
      })
    } finally {
      await cleanupAuthUser(owner.id)
    }
  })
})
