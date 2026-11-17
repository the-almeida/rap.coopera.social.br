import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { db } from '@/shared/db/client'
import { users } from '@/shared/db/schema/auth'
import { cleanupAuthUser, createTestUser } from '@/shared/db/test-helpers'
import { ExternalServiceError } from '@/shared/lib/errors/base'
import { err } from '@/shared/lib/result'

import { createFakeAuth } from '../../adapters/auth-provider.fake.test-helper'
import { AUTH_ERROR_MESSAGES } from '../../ports/auth-provider'

import { verifyPasswordWith } from './verify-password.logic'

// The verify-password step with the contract-checked fake in place of
// Supabase and the local database, where the proof is recorded.

const PASSWORD = 'correct-horse-1'
const auth = createFakeAuth()

const createdUserIds: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const id of createdUserIds.splice(0)) await cleanupAuthUser(id)
})

// An account whose password nobody proved, with its public.users row, and
// a browser that has just been emailed a code for it.
async function unprovenAccount({ passwordVerified = false } = {}) {
  const seeded = await createTestUser({ prefix: 'verify-password' })
  createdUserIds.push(seeded.id)
  auth.addUser({ email: seeded.email, password: PASSWORD, userId: seeded.id, passwordVerified })
  const session = auth.newSession()
  await session.requestSignInOtp({ email: seeded.email })
  return { ...seeded, session, code: auth.lastCodeSentTo(seeded.email) }
}

const deps = (session: ReturnType<typeof auth.newSession>) => ({
  authProvider: session,
  ip: `test-ip-${randomUUID()}`,
})

async function verifiedAt(id: string) {
  const [row] = await db
    .select({ at: users.passwordVerifiedAt })
    .from(users)
    .where(eq(users.id, id as typeof users.$inferSelect.id))
  return row?.at ?? null
}

describe('verify-password', () => {
  it('records the password as verified when the code and the password are both right', async () => {
    const account = await unprovenAccount()

    const result = await verifyPasswordWith(deps(account.session), {
      email: account.email,
      password: PASSWORD,
      token: account.code,
    })

    expect(result).toEqual({ ok: true, value: { passwordVerified: true } })
    expect(await verifiedAt(account.id)).toBeInstanceOf(Date)
    expect(await account.session.getCurrentIdentity()).toMatchObject({ userId: account.id })
  })

  it('refuses a wrong code without checking the password, which stays unverified', async () => {
    const account = await unprovenAccount()
    const probe = vi.spyOn(account.session, 'probePassword')

    const result = await verifyPasswordWith(deps(account.session), {
      email: account.email,
      password: PASSWORD,
      token: account.code === '000000' ? '111111' : '000000',
    })

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ message: AUTH_ERROR_MESSAGES.invalidCode }),
    })
    expect(probe).not.toHaveBeenCalled()
    expect(await verifiedAt(account.id)).toBeNull()
    expect(await account.session.getCurrentIdentity()).toBeNull()
  })

  it('keeps the mailbox owner signed in but the password untrusted when the password is wrong', async () => {
    const account = await unprovenAccount()

    const result = await verifyPasswordWith(deps(account.session), {
      email: account.email,
      password: 'someone-elses-password',
      token: account.code,
    })

    expect(result).toEqual({ ok: true, value: { passwordVerified: false } })
    expect(await verifiedAt(account.id)).toBeNull()
    expect(await account.session.getCurrentIdentity()).toMatchObject({ userId: account.id })
  })

  it('leaves an already verified password as it was', async () => {
    const account = await unprovenAccount({ passwordVerified: true })
    const verified = new Date('2026-01-01T00:00:00Z')
    await db.update(users).set({ passwordVerifiedAt: verified }).where(eq(users.id, account.id))

    const result = await verifyPasswordWith(deps(account.session), {
      email: account.email,
      password: PASSWORD,
      token: account.code,
    })

    expect(result).toEqual({ ok: true, value: { passwordVerified: true } })
    expect(await verifiedAt(account.id)).toEqual(verified)
  })

  it('trusts nothing when the password cannot be checked', async () => {
    const account = await unprovenAccount()
    vi.spyOn(account.session, 'probePassword').mockResolvedValue(
      err(new ExternalServiceError('supabase', AUTH_ERROR_MESSAGES.unavailable)),
    )

    const result = await verifyPasswordWith(deps(account.session), {
      email: account.email,
      password: PASSWORD,
      token: account.code,
    })

    expect(result).toEqual({ ok: true, value: { passwordVerified: false } })
    expect(await verifiedAt(account.id)).toBeNull()
  })
})
