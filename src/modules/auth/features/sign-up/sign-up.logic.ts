import { ok } from '@/shared/lib/result'
import { Events } from '@/shared/observability/analytics/events'
import { track } from '@/shared/observability/analytics/track'

import type { PublicAuthContext } from '../public-auth-context'
import { limitPublicAuthCall } from '../public-auth-rate-limits'

import type { SignUpInput } from './sign-up.schema'

export async function signUpWith({ authProvider, ip }: PublicAuthContext, input: SignUpInput) {
  const limited = await limitPublicAuthCall(
    'sign-up',
    { ip, email: input.email },
    { perIp: 30, perEmail: 5 },
  )
  if (!limited.ok) return limited

  const result = await authProvider.signUpWithPassword(input)
  if (!result.ok) return result

  track(Events.USER_SIGNED_UP, { method: 'email' })
  // The emailed code confirms the account and verifies the password
  // (verify-password). Same answer whether or not the email was new.
  return ok({ status: 'verification-required' as const, email: input.email })
}
