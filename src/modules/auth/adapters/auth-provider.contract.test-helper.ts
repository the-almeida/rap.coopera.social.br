import { randomUUID } from 'node:crypto'

import { afterAll, describe, expect, it } from 'vitest'

import { AUTH_ERROR_MESSAGES, type AuthProvider } from '../ports/auth-provider'

/**
 * The behavior every `AuthProvider` implementation must share. It runs
 * against the in-memory fake (unit) and against the Supabase adapter on the
 * local stack (integration), so the fake used by handler tests cannot drift
 * from what Supabase actually does.
 *
 * Each case was written against the Supabase adapter first (it passes
 * there: that is the reference), then made to pass on the fake. So the RED
 * of each case was observed on the fake.
 *
 * Errors are compared by `code` and by message: both reach the browser,
 * so the message must be one of `AUTH_ERROR_MESSAGES`, never the
 * provider's own text.
 *
 * Kept small on purpose: the local Supabase applies its own per-IP rate
 * limits (`[auth.rate_limit]` in supabase/config.toml) and every test runs
 * from the same IP.
 */
export type ContractSubject = {
  /** A provider with its own, empty session. */
  newSession(): AuthProvider
  /**
   * A session in the middle of an OAuth sign-in: the browser state a
   * provider redirect comes back to (for Supabase, the PKCE verifier
   * cookie), so an exchange is decided by the server, not the client.
   */
  newOAuthSession(): Promise<AuthProvider>
  /**
   * Setup only: a confirmed user with this password. By default the password
   * is verified (proven with the mailbox), as for an ordinary account;
   * `passwordVerified: false` is an account whose password nobody proved.
   */
  seedUser(email: string, password: string, options?: { passwordVerified?: boolean }): Promise<void>
  /** The 6-digit code most recently sent to `email`. */
  readOtp(email: string): Promise<string>
  /** Called once at the end with every email the suite used. */
  cleanup(emails: string[]): Promise<void>
  /** Whether an account exists for this email (checked out of band). */
  accountExists(email: string): Promise<boolean>
}

const PASSWORD = 'contract-password-1'

export function authProviderContract(name: string, subject: ContractSubject) {
  describe(`AuthProvider contract (${name})`, () => {
    const emails: string[] = []
    const newEmail = (prefix: string) => {
      const email = `${prefix}-${randomUUID()}@contract.test`
      emails.push(email)
      return email
    }

    afterAll(() => subject.cleanup(emails))

    it('signs up with a password without a session: the emailed code confirms the account', async () => {
      const email = newEmail('signup')
      const session = subject.newSession()

      const signedUp = await session.signUpWithPassword({
        email,
        password: PASSWORD,
        name: 'Contract',
      })

      expect(signedUp).toEqual({ ok: true, value: { confirmationRequired: true } })
      expect(await session.getCurrentIdentity()).toBeNull()
      const verified = await session.verifyOtp({ email, token: await subject.readOtp(email) })
      expect(verified).toEqual({ ok: true, value: { userId: expect.any(String), email } })
      // Confirming the email does not make the password trusted.
      expect(await session.probePassword({ email, password: PASSWORD })).toEqual({
        ok: true,
        value: 'unverified',
      })
    })

    it('refuses a password-only sign-in while the password is unverified, even when it is right', async () => {
      const email = newEmail('unverified')
      await subject.seedUser(email, PASSWORD, { passwordVerified: false })
      const session = subject.newSession()

      const result = await session.signInWithPassword({ email, password: PASSWORD })

      expect(result).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'PASSWORD_VERIFICATION_REQUIRED' }),
      })
      expect(await session.getCurrentIdentity()).toBeNull()
      // A wrong password reads the same as for any account.
      expect(await session.signInWithPassword({ email, password: 'nope-nope-1' })).toEqual({
        ok: false,
        error: expect.objectContaining({
          code: 'UNAUTHENTICATED',
          message: AUTH_ERROR_MESSAGES.invalidCredentials,
        }),
      })
    })

    it('checks a password without signing the session in, telling verified from unverified', async () => {
      const verifiedEmail = newEmail('probe-verified')
      const unverifiedEmail = newEmail('probe-unverified')
      await subject.seedUser(verifiedEmail, PASSWORD)
      await subject.seedUser(unverifiedEmail, PASSWORD, { passwordVerified: false })
      const session = subject.newSession()

      const verified = await session.probePassword({ email: verifiedEmail, password: PASSWORD })
      const unverified = await session.probePassword({ email: unverifiedEmail, password: PASSWORD })
      const wrong = await session.probePassword({ email: verifiedEmail, password: 'nope-nope-1' })

      expect(verified).toEqual({ ok: true, value: 'verified' })
      expect(unverified).toEqual({ ok: true, value: 'unverified' })
      expect(wrong).toEqual({
        ok: false,
        error: expect.objectContaining({
          code: 'UNAUTHENTICATED',
          message: AUTH_ERROR_MESSAGES.invalidCredentials,
        }),
      })
      expect(await session.getCurrentIdentity()).toBeNull()
    })

    it('checks a password without signing a signed-in session out', async () => {
      const email = newEmail('probe-signed-in')
      await subject.seedUser(email, PASSWORD)
      const session = subject.newSession()
      const signedIn = await session.signInWithPassword({ email, password: PASSWORD })

      await session.probePassword({ email, password: PASSWORD })

      expect(await session.getCurrentIdentity()).toEqual(signedIn.ok && signedIn.value)
    })

    it('creates a confirmed account on the server, and refuses an address that already has one', async () => {
      // Guest accounts only: an address on the reserved guest domain.
      const email = `guest_${randomUUID().slice(0, 8)}@guest.invalid`
      emails.push(email)

      const created = await subject
        .newSession()
        .createGuestUser({ email, password: PASSWORD, name: 'guest' })
      const again = await subject
        .newSession()
        .createGuestUser({ email, password: PASSWORD, name: 'guest' })

      expect(created).toEqual({ ok: true, value: { userId: expect.any(String), email } })
      expect(await subject.accountExists(email)).toBe(true)
      expect(again).toEqual({
        ok: false,
        error: expect.objectContaining({
          code: 'CONFLICT',
          message: AUTH_ERROR_MESSAGES.nicknameTaken,
        }),
      })
      // Confirmed, but its password is not trusted until the set-up records it.
      expect(await subject.newSession().probePassword({ email, password: PASSWORD })).toEqual({
        ok: true,
        value: 'unverified',
      })
    })

    it('deletes an account on the server', async () => {
      const email = `guest_${randomUUID().slice(0, 8)}@guest.invalid`
      emails.push(email)
      const created = await subject
        .newSession()
        .createGuestUser({ email, password: PASSWORD, name: 'guest' })
      if (!created.ok) throw new Error('setup: guest not created')

      const deleted = await subject.newSession().deleteUser(created.value.userId)

      expect(deleted).toEqual({ ok: true, value: undefined })
      expect(await subject.accountExists(email)).toBe(false)
    })

    it('rejects a wrong password', async () => {
      const email = newEmail('wrong-password')
      await subject.seedUser(email, PASSWORD)

      const result = await subject
        .newSession()
        .signInWithPassword({ email, password: 'nope-nope-1' })

      expect(result).toEqual({
        ok: false,
        error: expect.objectContaining({
          code: 'UNAUTHENTICATED',
          message: AUTH_ERROR_MESSAGES.invalidCredentials,
        }),
      })
    })

    it('rejects an email that has no account', async () => {
      const result = await subject
        .newSession()
        .signInWithPassword({ email: newEmail('unknown'), password: PASSWORD })

      expect(result).toEqual({
        ok: false,
        error: expect.objectContaining({
          code: 'UNAUTHENTICATED',
          message: AUTH_ERROR_MESSAGES.invalidCredentials,
        }),
      })
    })

    it('answers a password sign-up for an email that already has an account like a new one', async () => {
      // Answering differently would tell anyone which emails have accounts.
      const email = newEmail('duplicate')
      await subject.seedUser(email, PASSWORD)
      const session = subject.newSession()

      const result = await session.signUpWithPassword({
        email,
        password: 'other-password-1',
        name: 'Again',
      })

      expect(result).toEqual({ ok: true, value: { confirmationRequired: true } })
      expect(await session.getCurrentIdentity()).toBeNull()
      // The existing account is left as it was.
      const original = await subject.newSession().signInWithPassword({ email, password: PASSWORD })
      expect(original).toEqual({ ok: true, value: { userId: expect.any(String), email } })
      expect(
        await subject.newSession().signInWithPassword({ email, password: 'other-password-1' }),
      ).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } })
    })

    it('answers a sign-in code request for an unknown email like a known one, creating nothing', async () => {
      // Answering differently would tell anyone which emails have accounts.
      const email = newEmail('otp-unknown')

      const result = await subject.newSession().requestSignInOtp({ email })

      expect(result).toEqual({ ok: true, value: undefined })
      expect(await subject.accountExists(email)).toBe(false)
    })

    it('signs up with a code: the emailed code verifies and returns the new identity', async () => {
      const email = newEmail('otp-signup')
      const session = subject.newSession()

      expect(await session.requestSignUpOtp({ email, name: 'Contract' })).toEqual({
        ok: true,
        value: undefined,
      })
      const verified = await session.verifyOtp({ email, token: await subject.readOtp(email) })

      expect(verified).toEqual({
        ok: true,
        value: { userId: expect.any(String), email },
      })
      // Verifying the code is what signs the browser in.
      expect(await session.getCurrentIdentity()).toEqual(verified.ok && verified.value)
    })

    it('signs in with a code: the emailed code returns the existing identity', async () => {
      const email = newEmail('otp-signin')
      await subject.seedUser(email, PASSWORD)
      const known = await subject.newSession().signInWithPassword({ email, password: PASSWORD })
      const session = subject.newSession()

      expect(await session.requestSignInOtp({ email })).toEqual({ ok: true, value: undefined })
      const verified = await session.verifyOtp({ email, token: await subject.readOtp(email) })

      expect(verified).toEqual(known)
      expect(await session.getCurrentIdentity()).toEqual(known.ok && known.value)
    })

    it('rejects a wrong code', async () => {
      const email = newEmail('otp-wrong')
      await subject.seedUser(email, PASSWORD)
      const session = subject.newSession()
      expect(await session.requestSignInOtp({ email })).toEqual({ ok: true, value: undefined })
      const sent = await subject.readOtp(email)
      const wrong = sent === '000000' ? '111111' : '000000'

      const result = await session.verifyOtp({ email, token: wrong })

      expect(result).toEqual({
        ok: false,
        error: expect.objectContaining({
          code: 'UNAUTHENTICATED',
          message: AUTH_ERROR_MESSAGES.invalidCode,
        }),
      })
    })

    it('answers a code for an email with no account like a wrong code', async () => {
      const result = await subject
        .newSession()
        .verifyOtp({ email: newEmail('verify-unknown'), token: '123456' })

      expect(result).toEqual({
        ok: false,
        error: expect.objectContaining({
          code: 'UNAUTHENTICATED',
          message: AUTH_ERROR_MESSAGES.invalidCode,
        }),
      })
    })

    // Only the rejection is contract-checked: the local Supabase has no
    // working OAuth provider, so the success path exists on the fake only.
    it('rejects an OAuth code it did not issue', async () => {
      const session = await subject.newOAuthSession()

      const result = await session.exchangeOAuthCode('not-a-real-code')

      expect(result).toEqual({
        ok: false,
        error: expect.objectContaining({
          code: 'EXTERNAL_SERVICE_ERROR',
          message: AUTH_ERROR_MESSAGES.unavailable,
        }),
      })
    })

    it('tracks the current identity: none, then the signed-in user, then none after sign-out', async () => {
      const email = newEmail('session')
      await subject.seedUser(email, PASSWORD)
      const session = subject.newSession()

      expect(await session.getCurrentIdentity()).toBeNull()
      const signedIn = await session.signInWithPassword({ email, password: PASSWORD })
      if (!signedIn.ok) throw signedIn.error
      expect(await session.getCurrentIdentity()).toEqual(signedIn.value)
      expect(await session.signOut()).toEqual({ ok: true, value: undefined })
      expect(await session.getCurrentIdentity()).toBeNull()
    })

    it('treats emails as case-insensitive', async () => {
      const email = newEmail('case')
      await subject.seedUser(email, PASSWORD)

      const result = await subject
        .newSession()
        .signInWithPassword({ email: email.toUpperCase(), password: PASSWORD })

      // Stored lowercased, and found either way.
      expect(result).toEqual({ ok: true, value: { userId: expect.any(String), email } })
    })
  })
}
