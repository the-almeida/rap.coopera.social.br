import { ok } from '@/shared/lib/result'

import { userRepository } from '../../adapters/user-repository.drizzle'
import type { PublicAuthContext } from '../public-auth-context'
import { limitPublicAuthCall } from '../public-auth-rate-limits'

import type { VerifyPasswordInput } from './verify-password.schema'

/**
 * Proves, in one go, that the person who knows the password also controls
 * the mailbox, and only then trusts the password:
 *
 *   1. The emailed code first. It signs the browser in through the mailbox
 *      (and confirms a new sign-up). Without it nothing happens, so knowing
 *      only the password gets nowhere.
 *   2. Then the password, checked without touching that session.
 *
 * With both right, the password is recorded as verified and password-only
 * sign-ins work from then on. With the right code and a wrong password the
 * person still owns the mailbox and stays signed in, but the password stays
 * untrusted: that is the case of a password someone else set.
 *
 * Shares the code-guessing budget with verify-otp: both check emailed codes.
 */
export async function verifyPasswordWith(
  { authProvider, ip }: PublicAuthContext,
  input: VerifyPasswordInput,
) {
  const limited = await limitPublicAuthCall(
    'otp-verify',
    { ip, email: input.email },
    { perIp: 50, perEmail: 10 },
  )
  if (!limited.ok) return limited

  const session = await authProvider.verifyOtp({ email: input.email, token: input.token })
  if (!session.ok) return session

  const check = await authProvider.probePassword({ email: input.email, password: input.password })
  if (!check.ok) return ok({ passwordVerified: false })

  if (check.value === 'unverified') {
    await userRepository.markPasswordVerified(session.value.userId)
  }
  return ok({ passwordVerified: true })
}
