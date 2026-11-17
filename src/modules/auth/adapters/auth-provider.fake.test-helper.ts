import { randomInt, randomUUID } from 'node:crypto'

import {
  ConflictError,
  ExternalServiceError,
  PasswordVerificationRequiredError,
  UnauthenticatedError,
} from '@/shared/lib/errors/base'
import { UserIdSchema, type UserId } from '@/shared/lib/ids'
import { err, ok } from '@/shared/lib/result'

import { AUTH_ERROR_MESSAGES, type AuthIdentity, type AuthProvider } from '../ports/auth-provider'

/**
 * In-memory stand-in for Supabase Auth, for tests only. It is held to the
 * same contract as the Supabase adapter (auth-provider.contract.test-helper.ts),
 * which runs against both, so tests that use it test real behavior.
 *
 * One `createFakeAuth()` is one auth service (one Supabase project); each
 * `newSession()` is one browser, with its own current identity.
 *
 * Never import this from production code (lint forbids it): it signs anyone in.
 */
export function createFakeAuth() {
  // Lint stops static imports from production code; this also stops
  // dynamic ones, and anything else that slips past it.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The fake auth provider is for tests only; it signs anyone in.')
  }

  // `confirmed`: the email was confirmed (Confirm email is on).
  // `passwordVerified`: what public.users.password_verified_at holds for
  // Supabase; without it, password-only sessions are refused.
  type Account = {
    identity: AuthIdentity
    password: string | null
    confirmed: boolean
    passwordVerified: boolean
  }
  // By id, and by email.
  const accounts = new Map<UserId, Account>()
  const byEmail = new Map<string, UserId>()
  const codes = new Map<string, string>()
  const oauthCodes = new Map<string, string>()
  // Live sessions per account: ending one signs that browser out.
  const sessions = new Map<UserId, Set<symbol>>()

  const key = (email: string) => email.trim().toLowerCase()
  const findByEmail = (email: string) => {
    const id = byEmail.get(key(email))
    return id ? accounts.get(id) : undefined
  }

  function createAccount(
    email: string,
    password: string | null,
    {
      userId,
      confirmed = true,
      passwordVerified = true,
    }: Partial<Account> & { userId?: UserId } = {},
  ): Account {
    const account: Account = {
      identity: { userId: userId ?? UserIdSchema.parse(randomUUID()), email: key(email) },
      password,
      confirmed,
      passwordVerified,
    }
    accounts.set(account.identity.userId, account)
    byEmail.set(key(email), account.identity.userId)
    return account
  }

  function sendCode(email: string) {
    codes.set(key(email), String(randomInt(0, 1_000_000)).padStart(6, '0'))
  }

  function newSession(): AuthProvider & { signInAs(account: Account): void } {
    const token = Symbol('session')
    let currentId: UserId | null = null

    const current = () => {
      if (!currentId || !sessions.get(currentId)?.has(token)) return null
      return accounts.get(currentId) ?? null
    }
    function signInAs(account: Account) {
      currentId = account.identity.userId
      const live = sessions.get(currentId) ?? new Set()
      live.add(token)
      sessions.set(currentId, live)
    }

    return {
      signInAs,
      async signInWithPassword({ email, password }) {
        const account = findByEmail(email)
        if (!account || account.password !== password) {
          return err(new UnauthenticatedError(AUTH_ERROR_MESSAGES.invalidCredentials))
        }
        if (!account.confirmed) {
          return err(new ExternalServiceError('supabase', AUTH_ERROR_MESSAGES.unavailable))
        }
        if (!account.passwordVerified) return err(new PasswordVerificationRequiredError())
        signInAs(account)
        return ok(account.identity)
      },
      async createGuestUser({ email, password }) {
        if (findByEmail(email)) return err(new ConflictError(AUTH_ERROR_MESSAGES.nicknameTaken))
        return ok(createAccount(email, password, { passwordVerified: false }).identity)
      },
      async deleteUser(userId) {
        const account = accounts.get(userId)
        if (account) {
          accounts.delete(userId)
          byEmail.delete(account.identity.email)
          sessions.delete(userId)
        }
        return ok(undefined)
      },
      async probePassword({ email, password }) {
        const account = findByEmail(email)
        if (!account || account.password !== password) {
          return err(new UnauthenticatedError(AUTH_ERROR_MESSAGES.invalidCredentials))
        }
        if (!account.confirmed) {
          return err(new ExternalServiceError('supabase', AUTH_ERROR_MESSAGES.unavailable))
        }
        return ok(account.passwordVerified ? ('verified' as const) : ('unverified' as const))
      },
      async signUpWithPassword({ email, password }) {
        // An existing email gets the same answer and no email.
        if (!findByEmail(email)) {
          createAccount(email, password, { confirmed: false, passwordVerified: false })
          sendCode(email)
        }
        return ok({ confirmationRequired: true as const })
      },
      async requestSignInOtp({ email }) {
        // Same answer either way; only real accounts get a code.
        if (findByEmail(email)) sendCode(email)
        return ok(undefined)
      },
      async requestSignUpOtp({ email }) {
        // Like Supabase with shouldCreateUser: the account exists from
        // the request on; the code confirms it.
        if (!findByEmail(email)) createAccount(email, null, { confirmed: false })
        sendCode(email)
        return ok(undefined)
      },
      async verifyOtp({ email, token: code }) {
        const account = findByEmail(email)
        if (!account || codes.get(key(email)) !== code) {
          return err(new UnauthenticatedError(AUTH_ERROR_MESSAGES.invalidCode))
        }
        codes.delete(key(email))
        account.confirmed = true
        signInAs(account)
        return ok(account.identity)
      },
      async exchangeOAuthCode(code) {
        const email = oauthCodes.get(code)
        const account = email ? findByEmail(email) : undefined
        if (!account) {
          return err(new ExternalServiceError('supabase', AUTH_ERROR_MESSAGES.unavailable))
        }
        oauthCodes.delete(code)
        signInAs(account)
        return ok(account.identity)
      },
      async signOut() {
        if (currentId) sessions.get(currentId)?.delete(token)
        currentId = null
        return ok(undefined)
      },
      async getCurrentIdentity() {
        return current()?.identity ?? null
      },
    }
  }

  return {
    newSession: (): AuthProvider => newSession(),

    /**
     * Setup only (not part of the contract): a confirmed account. Pass the
     * id of a real auth user when the test also needs its public.users row.
     */
    addUser({
      email,
      password,
      userId,
      passwordVerified = true,
    }: {
      email: string
      password: string
      userId?: UserId
      passwordVerified?: boolean
    }): AuthIdentity {
      return createAccount(email, password, { userId, passwordVerified }).identity
    },

    /** Setup only: what verify-password records in public.users for Supabase. */
    markPasswordVerified(email: string): void {
      const account = findByEmail(email)
      if (!account) throw new Error(`no account for ${email}`)
      account.passwordVerified = true
    },

    /**
     * Setup only: an OAuth code as a provider would send it back to the
     * app's callback, for an existing account. Local Supabase cannot run a
     * real provider, so this path exists on the fake only.
     */
    issueOAuthCode(email: string): string {
      if (!findByEmail(email)) throw new Error(`no account for ${email}`)
      const code = randomUUID()
      oauthCodes.set(code, email)
      return code
    },

    /** Whether an account exists for this email (test inspection only). */
    hasAccount(email: string): boolean {
      return findByEmail(email) !== undefined
    },

    /** The code most recently "emailed" to this address. */
    lastCodeSentTo(email: string): string {
      const code = codes.get(key(email))
      if (!code) throw new Error(`no code was sent to ${email}`)
      return code
    },
  }
}
