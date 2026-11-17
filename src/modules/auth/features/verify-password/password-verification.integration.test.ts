import { randomUUID } from 'node:crypto'

import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { db } from '@/shared/db/client'
import {
  cleanupAuthUser,
  cleanupMailpitFor,
  createAnonSupabase,
  getAdminSupabase,
  pollMailpitForOtp,
  uniqueTestEmail,
} from '@/shared/db/test-helpers'

// A password is trusted only once the same person proved it together with
// the mailbox (an emailed code). Supabase Auth enforces it (a hook on every
// token it issues), so it also holds for callers that skip the app and talk
// to /auth/v1 directly with the public key.
describe('password-only sessions (local Supabase)', () => {
  const createdUserIds: string[] = []
  const usedEmails: string[] = []

  afterEach(async () => {
    for (const id of createdUserIds.splice(0)) await cleanupAuthUser(id)
    for (const email of usedEmails.splice(0)) await cleanupMailpitFor(email)
  })

  // A confirmed address with a password nobody proved: what anyone could
  // create while Confirm email was off (and what an admin-created account is).
  async function seedPasswordUser(prefix: string) {
    const email = uniqueTestEmail(prefix)
    const password = `pw-${randomUUID()}`
    const { data, error } = await getAdminSupabase().auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: `Password ${prefix}` },
    })
    if (error || !data.user) throw error ?? new Error('user not returned')
    createdUserIds.push(data.user.id)
    return { id: data.user.id, email, password }
  }

  it('refuses a password sign-in while the password is unverified, even when it is right', async () => {
    const user = await seedPasswordUser('unverified')

    const { data, error } = await createAnonSupabase().auth.signInWithPassword(user)

    expect(data.session).toBeNull()
    expect(error?.message).toContain('PASSWORD_VERIFICATION_REQUIRED')
  })

  it('stops an older password session from refreshing while the password is unverified', async () => {
    const user = await seedPasswordUser('old-session')
    // A session issued before the rule existed: signed in while the password
    // counted as verified, then the record is back to unverified.
    await db.execute(
      sql`UPDATE public.users SET password_verified_at = now() WHERE id = ${user.id}`,
    )
    const client = createAnonSupabase()
    const signedIn = await client.auth.signInWithPassword(user)
    if (signedIn.error) throw signedIn.error
    await db.execute(sql`UPDATE public.users SET password_verified_at = NULL WHERE id = ${user.id}`)

    const { data, error } = await client.auth.refreshSession()

    expect(data.session).toBeNull()
    expect(error?.message).toContain('PASSWORD_VERIFICATION_REQUIRED')
  })

  it('does not reveal an unverified password to a wrong-password attempt', async () => {
    const user = await seedPasswordUser('wrong')

    const { error } = await createAnonSupabase().auth.signInWithPassword({
      email: user.email,
      password: 'not-the-password',
    })

    expect(error?.code).toBe('invalid_credentials')
  })

  it('signs in with the password alone once it is verified', async () => {
    const user = await seedPasswordUser('verified')
    await db.execute(
      sql`UPDATE public.users SET password_verified_at = now() WHERE id = ${user.id}`,
    )

    const { data, error } = await createAnonSupabase().auth.signInWithPassword(user)

    expect(error).toBeNull()
    expect(data.session?.user.id).toBe(user.id)
  })

  it('issues no session on password sign-up and emails a code instead', async () => {
    const email = uniqueTestEmail('sign-up')
    usedEmails.push(email)

    const { data, error } = await createAnonSupabase().auth.signUp({
      email,
      password: `pw-${randomUUID()}`,
      options: { data: { name: 'Password sign-up' } },
    })
    if (data.user) createdUserIds.push(data.user.id)

    expect(error).toBeNull()
    expect(data.session).toBeNull()
    expect(await pollMailpitForOtp(email)).toMatch(/^\d{6}$/)
  })

  // The hook itself, for sign-in methods the local stack does not offer.
  async function hook(userId: string, methods: string[]) {
    const event = {
      user_id: userId,
      authentication_method: 'token_refresh',
      claims: { sub: userId, amr: methods.map((method) => ({ method, timestamp: 1 })) },
    }
    const [row] = await db.execute<{ out: { claims?: unknown; error?: { message: string } } }>(
      sql`SELECT public.custom_access_token_hook(${JSON.stringify(event)}::jsonb) AS out`,
    )
    return row?.out
  }

  it('refuses a session opened with the password and a second factor while the password is unverified', async () => {
    const user = await seedPasswordUser('second-factor')

    expect((await hook(user.id, ['password', 'totp']))?.error?.message).toBe(
      'PASSWORD_VERIFICATION_REQUIRED',
    )
  })

  it('lets a session through that also proved the mailbox or an OAuth provider', async () => {
    const user = await seedPasswordUser('mailbox')

    for (const proof of ['otp', 'magiclink', 'oauth']) {
      expect((await hook(user.id, ['password', proof]))?.error).toBeUndefined()
    }
  })

  it('stops trusting the password once it is changed, until the new one is proven', async () => {
    const user = await seedPasswordUser('changed')
    await db.execute(
      sql`UPDATE public.users SET password_verified_at = now() WHERE id = ${user.id}`,
    )

    await getAdminSupabase().auth.admin.updateUserById(user.id, { password: `pw-${randomUUID()}` })

    const [row] = await db.execute<{ verified_at: Date | null }>(
      sql`SELECT password_verified_at AS verified_at FROM public.users WHERE id = ${user.id}`,
    )
    expect(row?.verified_at).toBeNull()
  })
})
