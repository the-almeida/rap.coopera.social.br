import { isAuthApiError, type SupabaseClient } from '@supabase/supabase-js'

import {
  ConflictError,
  ExternalServiceError,
  PasswordVerificationRequiredError,
} from '@/shared/lib/errors/base'
import { err, ok } from '@/shared/lib/result'
import { logger } from '@/shared/observability/logger'

import { AUTH_ERROR_MESSAGES, type AuthProvider } from '../ports/auth-provider'

import { createSupabaseAdminClient } from './supabase/admin-client'
import { createSupabaseServerClient } from './supabase/server-client'
import { createSupabaseStatelessClient } from './supabase/stateless-client'
import { answersAsCodeSent, mapSupabaseAuthError } from './supabase-auth-errors'
import { identityFromSupabaseUser } from './supabase-identity'

// What public.custom_access_token_hook answers when it refuses a password-only
// session for an unverified password. Supabase Auth relays the hook's message.
const PASSWORD_VERIFICATION_REQUIRED = 'PASSWORD_VERIFICATION_REQUIRED'
const isVerificationRequired = (error: { message?: string }) =>
  Boolean(error.message?.includes(PASSWORD_VERIFICATION_REQUIRED))

/**
 * The Supabase implementation of `AuthProvider`. `getClient` returns the
 * Supabase client to use for each call: in the app, the server client bound
 * to the request's cookies; in the contract test, a client over an
 * in-memory cookie jar.
 */
export function createSupabaseAuthProvider(getClient: () => Promise<SupabaseClient>): AuthProvider {
  return {
    async signInWithPassword({ email, password }) {
      const supabase = await getClient()
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error && isVerificationRequired(error)) {
        return err(new PasswordVerificationRequiredError(undefined, { cause: error }))
      }
      if (error) return err(mapSupabaseAuthError('sign-in', error))
      return identityFromSupabaseUser(data.user)
    },
    async createGuestUser({ email, password, name }) {
      // Pre-confirmed and no email sent: safe only because a guest address
      // can never receive mail (domain/guest.ts). Never a user-typed address.
      const { data, error } = await createSupabaseAdminClient().auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name },
        // The marker the database asks for on guest addresses
        // (*_guest_domain_server_only.sql); users cannot set app_metadata.
        app_metadata: { guest: true },
      })
      if (error && isAuthApiError(error) && error.code === 'email_exists') {
        return err(new ConflictError(AUTH_ERROR_MESSAGES.nicknameTaken, { cause: error }))
      }
      if (error) return err(mapSupabaseAuthError('admin', error))
      return identityFromSupabaseUser(data.user)
    },
    async deleteUser(userId) {
      const { error } = await createSupabaseAdminClient().auth.admin.deleteUser(userId)
      if (error) return err(mapSupabaseAuthError('admin', error))
      return ok(undefined)
    },
    async probePassword({ email, password }) {
      // A throwaway client, so the caller's session cookies stay as they are.
      const probe = createSupabaseStatelessClient()
      const { error } = await probe.auth.signInWithPassword({ email, password })
      if (error && isVerificationRequired(error)) return ok('unverified' as const)
      if (error) return err(mapSupabaseAuthError('sign-in', error))
      await probe.auth.signOut({ scope: 'local' })
      return ok('verified' as const)
    },
    async signUpWithPassword({ email, password, name }) {
      const supabase = await getClient()
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name } },
      })
      // Supabase refuses an email that has a confirmed account; answered like
      // a new one, so the sign-up page tells nobody who is registered.
      if (error && isAuthApiError(error) && error.code === 'user_already_exists') {
        return ok({ confirmationRequired: true as const })
      }
      if (error) return err(mapSupabaseAuthError('sign-up', error))
      // With Confirm email on there is never a session here. One would mean
      // the project accepts unconfirmed emails, which the app must not.
      if (data.session) {
        logger.error(
          { source: 'supabase' },
          'Password sign-up opened a session: Confirm email is off',
        )
        await supabase.auth.signOut({ scope: 'local' })
        return err(new ExternalServiceError('supabase', AUTH_ERROR_MESSAGES.unavailable))
      }
      return ok({ confirmationRequired: true as const })
    },
    async requestSignInOtp({ email }) {
      const supabase = await getClient()
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false },
      })
      // An unknown email answers like a known one (no code is sent), so the
      // sign-in page cannot be used to find out who has an account.
      if (error && !answersAsCodeSent('sign-in', error)) {
        return err(mapSupabaseAuthError('otp-request', error))
      }
      return ok(undefined)
    },
    async requestSignUpOtp({ email, name }) {
      const supabase = await getClient()
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { data: { name }, shouldCreateUser: true },
      })
      if (error && !answersAsCodeSent('sign-up', error)) {
        return err(mapSupabaseAuthError('otp-request', error))
      }
      return ok(undefined)
    },
    async verifyOtp({ email, token }) {
      const supabase = await getClient()
      const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' })
      if (error) return err(mapSupabaseAuthError('verify', error))
      if (!data.user) {
        return err(new ExternalServiceError('supabase', AUTH_ERROR_MESSAGES.unavailable))
      }
      return identityFromSupabaseUser(data.user)
    },
    async exchangeOAuthCode(code) {
      // Uses the PKCE verifier cookie set by signInWithOAuth and writes the
      // session cookies on the app origin.
      const supabase = await getClient()
      const { data, error } = await supabase.auth.exchangeCodeForSession(code)
      if (error) return err(mapSupabaseAuthError('oauth', error))
      return identityFromSupabaseUser(data.user)
    },
    async signOut() {
      const supabase = await getClient()
      const { error } = await supabase.auth.signOut()
      if (error) return err(mapSupabaseAuthError('sign-out', error))
      return ok(undefined)
    },
    async getCurrentIdentity() {
      const supabase = await getClient()
      // The SDK throws `AuthApiError` (e.g. refresh_token_not_found) for
      // anonymous traffic and stale-cookie refreshes. Treat any such failure
      // as "no current user"; real failures will surface at the next sign-in.
      try {
        const { data } = await supabase.auth.getUser()
        if (!data.user) return null
        const result = identityFromSupabaseUser(data.user)
        return result.ok ? result.value : null
      } catch {
        return null
      }
    },
  }
}

export const authProvider = createSupabaseAuthProvider(createSupabaseServerClient)
