'use server'

import { ValidationError } from '@/shared/lib/errors/base'
import { withErrorBoundary } from '@/shared/lib/errors/with-error-boundary'
import { getRequestIp } from '@/shared/lib/http/request-ip'
import { err } from '@/shared/lib/result'

import { authProvider } from '../../adapters/auth-provider.supabase'

import { verifyPasswordWith } from './verify-password.logic'
import { verifyPasswordSchema } from './verify-password.schema'

/**
 * The code step after a password sign-up, and after a password sign-in
 * whose password was never verified. Signs the browser in and, when the
 * code and the password are both right, trusts the password from then on.
 */
export const verifyPassword = withErrorBoundary(async (raw: unknown) => {
  const parsed = verifyPasswordSchema.safeParse(raw)
  if (!parsed.success) {
    return err(new ValidationError(parsed.error.flatten()))
  }

  return verifyPasswordWith({ authProvider, ip: await getRequestIp() }, parsed.data)
})
