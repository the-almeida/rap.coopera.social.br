import {
  ConflictError,
  PasswordVerificationRequiredError,
  UnauthenticatedError,
} from '@/shared/lib/errors/base'
import { rateLimit } from '@/shared/lib/rate-limit'
import { err, ok } from '@/shared/lib/result'
import { Events } from '@/shared/observability/analytics/events'
import { track } from '@/shared/observability/analytics/track'
import { logger } from '@/shared/observability/logger'

import { userRepository } from '../../adapters/user-repository.drizzle'
import { guestEmailFromNickname } from '../../domain/guest'
import type { PublicAuthContext } from '../public-auth-context'
import { limitPublicAuthCall } from '../public-auth-rate-limits'

import type { ContinueAsGuestInput } from './continue-as-guest.schema'

export const NICKNAME_TAKEN_MESSAGE =
  "That nickname is taken and the password doesn't match. If it's yours, check the password; otherwise pick another nickname."

/**
 * "Continue as guest": one step for a new nickname and a returning one. A
 * nickname with an account signs in with the password; a free one gets a new
 * guest account, signed in at once.
 *
 * Same limits as a password sign-in, with the nickname in the email's place,
 * and a stricter per-IP budget for creating accounts (bulk accounts are the
 * abuse here). The handler also asks for a CAPTCHA on every attempt.
 */
export async function continueAsGuestWith(
  { authProvider, ip }: PublicAuthContext,
  input: ContinueAsGuestInput,
) {
  const limited = await limitPublicAuthCall(
    'guest',
    { ip, email: input.nickname },
    { perIp: 30, perEmail: 10 },
  )
  if (!limited.ok) return limited

  // A nickname stays with its account, even after an email is added: sign
  // in with the account's current email.
  const owner = await userRepository.findByGuestNickname(input.nickname)
  if (owner) {
    const session = await authProvider.signInWithPassword({
      email: owner.email,
      password: input.password,
    })
    if (session.ok) {
      track(Events.USER_SIGNED_IN, { method: 'guest' })
      return ok({ status: 'signed-in' as const })
    }
    // A nickname is public, so saying it is taken reveals nothing; the
    // account's email never shows. A password that is not trusted cannot be
    // proven (a guest has no mailbox), so it answers like a wrong one.
    if (
      session.error instanceof UnauthenticatedError ||
      session.error instanceof PasswordVerificationRequiredError
    ) {
      return err(new UnauthenticatedError(NICKNAME_TAKEN_MESSAGE, { cause: session.error }))
    }
    return session
  }

  const creations = await rateLimit(`guest-create:ip:${ip}`, { windowMs: 60_000, max: 10 })
  if (!creations.ok) return creations

  const email = guestEmailFromNickname(input.nickname)
  const created = await authProvider.createGuestUser({
    email,
    password: input.password,
    name: input.nickname,
  })
  if (!created.ok && created.error instanceof ConflictError) {
    // Someone created this nickname between the lookup and now.
    return err(new UnauthenticatedError(NICKNAME_TAKEN_MESSAGE, { cause: created.error }))
  }
  if (!created.ok) return created

  // Reserving the nickname and trusting the password must happen before the
  // sign-in (the token hook refuses an untrusted password). If it fails, the
  // account goes again: otherwise it would hold the nickname for good while
  // nobody could sign into it.
  try {
    await userRepository.completeGuestSetup(created.value.userId, input.nickname)
  } catch (error) {
    const deleted = await authProvider
      .deleteUser(created.value.userId)
      .catch((cause: unknown) => ({ ok: false as const, error: cause }))
    if (!deleted.ok) {
      // The account stays without its nickname, and the nickname answers
      // "taken" until someone deletes it. The first error is the one to show.
      logger.error(
        { source: 'guest-account', userId: created.value.userId, err: deleted.error },
        'A guest account whose set-up failed could not be deleted',
      )
    }
    throw error
  }

  const session = await authProvider.signInWithPassword({ email, password: input.password })
  if (!session.ok) return session
  track(Events.USER_SIGNED_UP, { method: 'guest' })
  return ok({ status: 'created' as const })
}
