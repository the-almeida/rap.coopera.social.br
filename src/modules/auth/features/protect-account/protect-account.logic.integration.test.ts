import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { db } from '@/shared/db/client'
import { guestEmailVerifications, users } from '@/shared/db/schema/auth'
import {
  cleanupAuthUser,
  createTestGuest,
  createTestUser,
  getAdminSupabase,
  uniqueTestEmail,
} from '@/shared/db/test-helpers'
import { ExternalServiceError } from '@/shared/lib/errors/base'
import { err, ok } from '@/shared/lib/result'
import type { EmailMessage } from '@/shared/lib/email'

import { authProvider } from '../../adapters/auth-provider.supabase'
import { guestEmailVerificationRepository as verifications } from '../../adapters/guest-email-verification-repository.drizzle'
import { userRepository } from '../../adapters/user-repository.drizzle'

import { hashCode } from './guest-email-code'
import {
  INVALID_CODE_MESSAGE,
  requestGuestEmailFor,
  verifyGuestEmailFor,
} from './protect-account.logic'

// Adding a verified email to a guest account, against the local Supabase and
// database. Emails are caught instead of sent.

const createdUserIds: string[] = []
afterEach(async () => {
  for (const id of createdUserIds.splice(0)) await cleanupAuthUser(id)
})

async function guest() {
  const created = await createTestGuest('protect')
  createdUserIds.push(created.id)
  const user = await userRepository.findById(created.id)
  if (!user) throw new Error('setup: guest row missing')
  return user
}

function inbox() {
  const sent: EmailMessage[] = []
  return {
    sent,
    sendEmail: async (message: EmailMessage) => {
      sent.push(message)
      return ok(undefined)
    },
    code: () => sent.at(-1)?.text.match(/\b(\d{6})\b/)?.[1] ?? '',
  }
}

const pending = async (userId: string) =>
  (
    await db
      .select()
      .from(guestEmailVerifications)
      .where(eq(guestEmailVerifications.userId, userId as typeof users.$inferSelect.id))
  )[0]

describe('adding an email to a guest account', () => {
  it('emails a code to the address and keeps only its hash, for 15 minutes', async () => {
    const user = await guest()
    const mail = inbox()
    const email = uniqueTestEmail('protect')
    const before = Date.now()

    const result = await requestGuestEmailFor(user, { email }, { sendEmail: mail.sendEmail })

    expect(result).toEqual({ ok: true, value: { email } })
    expect(mail.sent).toEqual([expect.objectContaining({ to: email })])
    const row = await pending(user.id)
    expect(row).toMatchObject({ email, attempts: 0 })
    expect(row?.codeHash).not.toContain(mail.code())
    expect(row?.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 15 * 60_000 - 1_000)
    expect(row?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 15 * 60_000)
  })

  it('refuses an address another account has, sending nothing', async () => {
    const user = await guest()
    const other = await createTestUser({ prefix: 'protect-taken' })
    createdUserIds.push(other.id)
    const mail = inbox()

    const result = await requestGuestEmailFor(user, { email: other.email.toUpperCase() }, mail)

    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'CONFLICT' }) })
    expect(mail.sent).toEqual([])
    expect(await pending(user.id)).toBeUndefined()
  })

  it('refuses an account that started with an email: changing its email is another feature', async () => {
    // Otherwise a stolen session could move such an account to any address
    // the thief reads, without the current address ever being asked.
    const owner = await createTestUser({ prefix: 'protect-not-guest' })
    createdUserIds.push(owner.id)
    const user = await userRepository.findById(owner.id)
    if (!user) throw new Error('setup: row missing')
    const mail = inbox()

    const result = await requestGuestEmailFor(user, { email: uniqueTestEmail('protect') }, mail)

    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'FORBIDDEN' }) })
    expect(mail.sent).toEqual([])
  })

  it('sends at most 3 codes an hour to one address, whichever guests ask', async () => {
    // Guests are cheap to make: a limit per account alone would let many of
    // them flood one inbox, or guess at the codes sent to it.
    const email = uniqueTestEmail('protect-flood')
    const mail = inbox()
    for (let guestNumber = 0; guestNumber < 3; guestNumber++) {
      expect(await requestGuestEmailFor(await guest(), { email }, mail)).toMatchObject({ ok: true })
    }

    const fourth = await requestGuestEmailFor(await guest(), { email }, mail)

    expect(fourth).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'RATE_LIMIT_EXCEEDED' }),
    })
    expect(mail.sent).toHaveLength(3)
  })

  it('drops the pending code when the email could not be sent', async () => {
    const user = await guest()
    const failure = new ExternalServiceError('email', 'We could not send the email. Try again.')

    const result = await requestGuestEmailFor(
      user,
      { email: uniqueTestEmail('protect') },
      { sendEmail: async () => err(failure) },
    )

    expect(result).toEqual({ ok: false, error: failure })
    expect(await pending(user.id)).toBeUndefined()
  })
})

describe('verifying the code', () => {
  async function requested() {
    const user = await guest()
    const mail = inbox()
    const email = uniqueTestEmail('protect')
    await requestGuestEmailFor(user, { email }, mail)
    return { user, email, code: mail.code() }
  }
  const wrong = (code: string) => (code === '000000' ? '111111' : '000000')
  const deps = { authProvider }
  const row = async (id: string) =>
    (
      await db
        .select()
        .from(users)
        .where(eq(users.id, id as typeof users.$inferSelect.id))
    )[0]

  it('makes the address the account email with the right code, keeping password and nickname', async () => {
    const { user, email, code } = await requested()

    const result = await verifyGuestEmailFor(user, { email, code }, deps)

    expect(result).toEqual({ ok: true, value: { email } })
    expect(await row(user.id)).toMatchObject({ email, guestNickname: user.guestNickname })
    expect((await row(user.id))?.passwordVerifiedAt).toBeInstanceOf(Date)
    expect(await pending(user.id)).toBeUndefined()
  })

  it('counts a wrong code and leaves the email as it was', async () => {
    const { user, email, code } = await requested()

    const result = await verifyGuestEmailFor(user, { email, code: wrong(code) }, deps)

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ message: INVALID_CODE_MESSAGE }),
    })
    expect((await row(user.id))?.email).toBe(user.email)
    expect((await pending(user.id))?.attempts).toBe(1)
  })

  it('does not let a code sent to one address verify another', async () => {
    const { user, code } = await requested()

    const result = await verifyGuestEmailFor(
      user,
      { email: uniqueTestEmail('protect-other'), code },
      deps,
    )

    expect(result).toMatchObject({ ok: false, error: { message: INVALID_CODE_MESSAGE } })
    expect((await row(user.id))?.email).toBe(user.email)
  })

  it('burns the code after 5 tries: even the right one no longer works', async () => {
    const { user, email, code } = await requested()
    for (let attempt = 0; attempt < 5; attempt++) {
      await verifyGuestEmailFor(user, { email, code: wrong(code) }, deps)
    }

    const result = await verifyGuestEmailFor(user, { email, code }, deps)

    expect(result).toMatchObject({ ok: false, error: { message: INVALID_CODE_MESSAGE } })
    expect(await pending(user.id)).toBeUndefined()
    expect((await row(user.id))?.email).toBe(user.email)
  })

  it('refuses and burns an expired code', async () => {
    const { user, email, code } = await requested()
    await db
      .update(guestEmailVerifications)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(guestEmailVerifications.userId, user.id))

    const result = await verifyGuestEmailFor(user, { email, code }, deps)

    expect(result).toMatchObject({ ok: false, error: { message: INVALID_CODE_MESSAGE } })
    expect(await pending(user.id)).toBeUndefined()
  })

  it('refuses an account that started with an email, leaving its email as it was', async () => {
    const owner = await createTestUser({ prefix: 'protect-not-guest' })
    createdUserIds.push(owner.id)
    const user = await userRepository.findById(owner.id)
    if (!user) throw new Error('setup: row missing')

    // A matching code is pending, so only the guest-only rule stands in the way.
    const email = uniqueTestEmail('protect')
    await verifications.upsert({
      userId: user.id,
      email,
      codeHash: hashCode(user.id, email, '123456'),
      expiresAt: new Date(Date.now() + 60_000),
    })

    const result = await verifyGuestEmailFor(user, { email, code: '123456' }, deps)

    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'FORBIDDEN' }) })
    expect((await row(user.id))?.email).toBe(owner.email)
  })

  it('still accepts the right code on the 5th try', async () => {
    const { user, email, code } = await requested()
    for (let attempt = 0; attempt < 4; attempt++) {
      await verifyGuestEmailFor(user, { email, code: wrong(code) }, deps)
    }

    expect(await verifyGuestEmailFor(user, { email, code }, deps)).toEqual({
      ok: true,
      value: { email },
    })
  })

  it('refuses when no code is pending', async () => {
    const user = await guest()

    const result = await verifyGuestEmailFor(
      user,
      { email: uniqueTestEmail('protect'), code: '123456' },
      deps,
    )

    expect(result).toMatchObject({ ok: false, error: { message: INVALID_CODE_MESSAGE } })
  })

  it('refuses an address another account took in the meantime', async () => {
    const { user, email, code } = await requested()
    const other = await createTestUser({ prefix: 'protect-meanwhile' })
    createdUserIds.push(other.id)
    const { error } = await getAdminSupabase().auth.admin.updateUserById(other.id, {
      email,
      email_confirm: true,
    })
    if (error) throw error

    const result = await verifyGuestEmailFor(user, { email, code }, deps)

    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'CONFLICT' }) })
    expect((await row(user.id))?.email).toBe(user.email)
  })
})
