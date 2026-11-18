import { randomUUID } from 'node:crypto'

import { afterEach, describe, expect, it } from 'vitest'

import { cleanupAuthUser, createAnonSupabase, getAdminSupabase } from '@/shared/db/test-helpers'
import { UserIdSchema } from '@/shared/lib/ids'

import { guestEmailFromNickname } from '../domain/guest'

import { guestEmailVerificationRepository as verifications } from './guest-email-verification-repository.drizzle'
import { userRepository } from './user-repository.drizzle'

// Pending codes that add an email to a guest account, against the local
// database.

const createdUserIds: string[] = []
afterEach(async () => {
  for (const id of createdUserIds.splice(0)) await cleanupAuthUser(id)
})

async function seedGuest() {
  const nickname = `gev_${randomUUID().replaceAll('-', '').slice(0, 12)}`
  const password = `pw-${randomUUID()}`
  const { data, error } = await getAdminSupabase().auth.admin.createUser({
    email: guestEmailFromNickname(nickname),
    password,
    email_confirm: true,
    user_metadata: { name: nickname },
    app_metadata: { guest: true },
  })
  if (error || !data.user) throw error ?? new Error('guest not created')
  createdUserIds.push(data.user.id)
  const id = UserIdSchema.parse(data.user.id)
  await userRepository.completeGuestSetup(id, nickname)
  return { id, email: guestEmailFromNickname(nickname), password }
}

const inAMinute = () => new Date(Date.now() + 60_000)

describe('guest email verifications', () => {
  it('counts attempts one by one even when they arrive together', async () => {
    const { id } = await seedGuest()
    await verifications.upsert({
      userId: id,
      email: 'a@example.com',
      codeHash: 'h1',
      expiresAt: inAMinute(),
    })

    const counts = await Promise.all(
      Array.from({ length: 5 }, () => verifications.incrementAttempts(id)),
    )

    expect([...counts].sort()).toEqual([1, 2, 3, 4, 5])
  })

  it('replaces the pending code and resets its attempts when a new one is requested', async () => {
    const { id } = await seedGuest()
    await verifications.upsert({
      userId: id,
      email: 'a@example.com',
      codeHash: 'h1',
      expiresAt: inAMinute(),
    })
    await verifications.incrementAttempts(id)

    await verifications.upsert({
      userId: id,
      email: 'b@example.com',
      codeHash: 'h2',
      expiresAt: inAMinute(),
    })

    expect(await verifications.find(id)).toMatchObject({
      email: 'b@example.com',
      codeHash: 'h2',
      attempts: 0,
    })
  })

  it('answers nothing pending once the code is deleted', async () => {
    const { id } = await seedGuest()
    await verifications.upsert({
      userId: id,
      email: 'a@example.com',
      codeHash: 'h1',
      expiresAt: inAMinute(),
    })

    await verifications.delete(id)

    expect(await verifications.find(id)).toBeNull()
    expect(await verifications.incrementAttempts(id)).toBeNull()
  })

  it('keeps the codes out of the Data API, even for their owner', async () => {
    const guest = await seedGuest()
    await verifications.upsert({
      userId: guest.id,
      email: 'a@example.com',
      codeHash: 'secret-hash',
      expiresAt: inAMinute(),
    })
    const client = createAnonSupabase()
    const signedIn = await client.auth.signInWithPassword({
      email: guest.email,
      password: guest.password,
    })
    if (signedIn.error) throw signedIn.error

    const { data, error } = await client.from('guest_email_verifications').select('*')

    // No privilege at all, not just no rows: the table is closed to the API roles.
    expect(error?.code).toBe('42501')
    expect(data).toBeNull()
  })

  it('goes with its account', async () => {
    const { id } = await seedGuest()
    await verifications.upsert({
      userId: id,
      email: 'a@example.com',
      codeHash: 'h1',
      expiresAt: inAMinute(),
    })

    await cleanupAuthUser(id)

    expect(await verifications.find(id)).toBeNull()
  })
})
