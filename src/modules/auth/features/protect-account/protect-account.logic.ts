import type { EmailMessage } from '@/shared/lib/email'
import {
  ConflictError,
  type ExternalServiceError,
  type ForbiddenError,
  UnauthenticatedError,
} from '@/shared/lib/errors/base'
import { rateLimit, rateLimitKey, type RateLimitExceededError } from '@/shared/lib/rate-limit'
import { err, ok, type Result } from '@/shared/lib/result'

import { guestEmailVerificationRepository as verifications } from '../../adapters/guest-email-verification-repository.drizzle'
import { userRepository } from '../../adapters/user-repository.drizzle'
import { accountProtectionPolicy } from '../../domain/policy'
import type { User } from '../../domain/user'
import { AUTH_ERROR_MESSAGES, type AuthError, type AuthProvider } from '../../ports/auth-provider'

import {
  CODE_TTL_MS,
  codeMatches,
  generateCode,
  hashCode,
  MAX_ATTEMPTS,
  verificationEmail,
} from './guest-email-code'

export const INVALID_CODE_MESSAGE = 'That code is wrong or has expired. Ask for a new one.'

type SendEmail = (message: EmailMessage) => Promise<Result<void, ExternalServiceError>>

/** Whether another account already uses this email (compared ignoring case). */
async function takenByAnother(user: User, email: string) {
  const owner = await userRepository.findByEmail(email)
  return owner !== null && owner.id !== user.id
}

/**
 * Adding an email to a guest account, step 1: the app emails its own 6-digit
 * code to the new address. Supabase's email change cannot be used: it also
 * confirms on the current address, which a guest's cannot receive, and
 * turning that check off would weaken every other account. Only a hash of
 * the code is kept, tied to the account and the address.
 *
 * An address another account has is refused before anything is sent. One
 * address gets at most 3 codes an hour and 10 a day, whichever accounts ask:
 * guests are cheap to make, so a limit per account alone would let many of
 * them flood an inbox, or guess at the codes sent to it.
 */
export async function requestGuestEmailFor(
  user: User,
  { email }: { email: string },
  { sendEmail }: { sendEmail: SendEmail },
): Promise<
  Result<
    { email: string },
    ForbiddenError | ConflictError | ExternalServiceError | RateLimitExceededError
  >
> {
  const authz = accountProtectionPolicy(user, { type: 'add-email' })
  if (!authz.ok) return authz
  if (await takenByAnother(user, email)) {
    return err(new ConflictError(AUTH_ERROR_MESSAGES.emailUnavailable))
  }
  for (const [window, windowMs, max] of [
    ['hour', 60 * 60_000, 3],
    ['day', 24 * 60 * 60_000, 10],
  ] as const) {
    const limited = await rateLimit(rateLimitKey(`guest-email:${window}`, 'email', email), {
      windowMs,
      max,
    })
    if (!limited.ok) return limited
  }

  const code = generateCode()
  await verifications.upsert({
    userId: user.id,
    email,
    codeHash: hashCode(user.id, email, code),
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  })

  const sent = await sendEmail({ to: email, ...verificationEmail(code) })
  if (!sent.ok) {
    await verifications.delete(user.id)
    return sent
  }
  return ok({ email })
}

/**
 * Step 2: the code proves the person reads that mailbox, and the address
 * becomes the account's email (public.users follows through the email sync
 * trigger). The password stays trusted: whoever chose it at creation has now
 * proven the mailbox in the same session. The nickname keeps working.
 *
 * Every try is counted in the database before comparing, so tries sent at
 * once cannot exceed the limit; the code is burned when the tries run out,
 * when it expires, and once it worked.
 */
export async function verifyGuestEmailFor(
  user: User,
  { email, code }: { email: string; code: string },
  { authProvider }: { authProvider: AuthProvider },
): Promise<
  Result<{ email: string }, ForbiddenError | UnauthenticatedError | ConflictError | AuthError>
> {
  const authz = accountProtectionPolicy(user, { type: 'add-email' })
  if (!authz.ok) return authz
  const invalid = () => err(new UnauthenticatedError(INVALID_CODE_MESSAGE))

  const attempts = await verifications.incrementAttempts(user.id)
  if (attempts === null) return invalid()
  if (attempts > MAX_ATTEMPTS) {
    await verifications.delete(user.id)
    return invalid()
  }

  const pending = await verifications.find(user.id)
  if (!pending) return invalid()
  if (pending.expiresAt.getTime() <= Date.now()) {
    await verifications.delete(user.id)
    return invalid()
  }
  if (pending.email !== email || !codeMatches(pending.codeHash, user.id, email, code)) {
    return invalid()
  }

  if (await takenByAnother(user, email)) {
    await verifications.delete(user.id)
    return err(new ConflictError(AUTH_ERROR_MESSAGES.emailUnavailable))
  }
  const applied = await authProvider.setVerifiedEmail({ userId: user.id, email })
  if (!applied.ok) return applied

  await verifications.delete(user.id)
  return ok({ email })
}
