import type {
  ConflictError,
  ExternalServiceError,
  PasswordVerificationRequiredError,
  UnauthenticatedError,
  ValidationError,
} from '@/shared/lib/errors/base'
import type { RateLimitExceededError } from '@/shared/lib/rate-limit'
import type { UserId } from '@/shared/lib/ids'
import type { Result } from '@/shared/lib/result'

export type OAuthProvider = 'google' | 'facebook'

export type AuthIdentity = {
  userId: UserId
  email: string
}

/**
 * A checked password: `verified` when it was proven with the mailbox,
 * `unverified` when it is right but Supabase Auth still refuses a
 * password-only session for it.
 */
export type PasswordCheck = 'verified' | 'unverified'

export type AuthError =
  | ConflictError
  | UnauthenticatedError
  | ValidationError
  | ExternalServiceError
  | RateLimitExceededError

/**
 * The only messages an `AuthProvider` returns: they reach the browser, so
 * they never carry the provider's own text (which can reveal whether an
 * email has an account). The provider's error stays in `cause`. Every
 * implementation uses these, and the contract suite checks them.
 */
export const AUTH_ERROR_MESSAGES = {
  invalidCredentials: 'Invalid email or password.',
  invalidCode: 'Invalid or expired code.',
  nicknameTaken: 'This nickname is already taken.',
  tooManyAttempts: 'Too many attempts. Wait a minute and try again.',
  unavailable: 'Sign-in is unavailable right now. Try again.',
  emailUnavailable: 'This email cannot be used. If it is yours, sign in with it instead.',
} as const

export type AuthProvider = {
  /**
   * `PasswordVerificationRequiredError` when the password is right but was
   * never proven together with the mailbox; a wrong password is
   * `UnauthenticatedError` either way, so nothing tells the two apart.
   */
  signInWithPassword(input: {
    email: string
    password: string
  }): Promise<Result<AuthIdentity, AuthError | PasswordVerificationRequiredError>>
  /**
   * Opens no session (Confirm email is on): emails a 6-digit code that
   * confirms the account. An email that already has an account gets the
   * same answer and no email, so the answer tells nobody who is registered.
   */
  signUpWithPassword(input: {
    email: string
    password: string
    name: string
  }): Promise<Result<{ confirmationRequired: true }, AuthError>>
  /**
   * Server only: creates an already-confirmed account and sends no email.
   * Only for guest accounts, whose address is on the reserved guest domain
   * (domain/guest.ts): it has no mailbox to confirm and no owner to protect.
   * An address that already has an account is `ConflictError`.
   */
  createGuestUser(input: {
    email: string
    password: string
    name: string
  }): Promise<Result<AuthIdentity, AuthError>>
  /**
   * Server only: moves an account to an email the app verified itself (with
   * its own emailed code), skipping Supabase's confirmation of the change.
   * For guest accounts, whose current address cannot receive the code
   * Supabase's secure email change would send it. An email another account
   * has fails without a reason Supabase tells apart, so callers check first.
   */
  setVerifiedEmail(input: { userId: UserId; email: string }): Promise<Result<void, AuthError>>
  /**
   * How the signed-in account can sign in ('email', 'google', 'facebook'…);
   * empty without a session. A guest with Google or Facebook linked can be
   * recovered through it.
   */
  getCurrentIdentityProviders(): Promise<string[]>
  /** Server only: deletes an account (undoing a guest set-up that failed halfway). */
  deleteUser(userId: UserId): Promise<Result<void, AuthError>>
  /**
   * Checks email and password without touching this session (nothing is
   * signed in or out). A wrong password is `UnauthenticatedError`.
   */
  probePassword(input: {
    email: string
    password: string
  }): Promise<Result<PasswordCheck, AuthError>>
  /**
   * Sends a 6-digit code to an EXISTING user, and never creates an account
   * (`shouldCreateUser: false`). An unknown email answers `ok` like a known
   * one, but nothing is sent: a different answer would tell anyone which
   * emails have accounts.
   */
  requestSignInOtp(input: { email: string }): Promise<Result<void, AuthError>>
  /**
   * Sends a 6-digit code and auto-creates the user on first request
   * (`shouldCreateUser: true`). `name` lands in `raw_user_meta_data`
   * which the public.users sync trigger consumes.
   */
  requestSignUpOtp(input: { email: string; name: string }): Promise<Result<void, AuthError>>
  verifyOtp(input: { email: string; token: string }): Promise<Result<AuthIdentity, AuthError>>
  /**
   * Finishes an OAuth sign-in: trades the code the provider sent back to the
   * app's callback for a session, and returns who signed in.
   */
  exchangeOAuthCode(code: string): Promise<Result<AuthIdentity, AuthError>>
  signOut(): Promise<Result<void, AuthError>>
  getCurrentIdentity(): Promise<AuthIdentity | null>
}
