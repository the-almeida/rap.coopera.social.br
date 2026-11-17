'use server'

import { verifyCaptcha } from '@/shared/lib/captcha'
import { ValidationError } from '@/shared/lib/errors/base'
import { withErrorBoundary } from '@/shared/lib/errors/with-error-boundary'
import { getRequestIp } from '@/shared/lib/http/request-ip'
import { err } from '@/shared/lib/result'

import { authProvider } from '../../adapters/auth-provider.supabase'

import { continueAsGuestWith } from './continue-as-guest.logic'
import { continueAsGuestSchema } from './continue-as-guest.schema'

/**
 * "Continue as guest": signs a returning nickname in, or creates a new guest
 * account, in one step. The form must say that a guest account cannot be
 * recovered if the password is lost, until an email or Google/Facebook is
 * added to it.
 *
 * Every attempt needs a CAPTCHA: this path creates accounts with no other
 * friction, through the admin API, where Supabase's own CAPTCHA never runs.
 */
export const continueAsGuest = withErrorBoundary(async (raw: unknown) => {
  const parsed = continueAsGuestSchema.safeParse(raw)
  if (!parsed.success) {
    return err(new ValidationError(parsed.error.flatten()))
  }
  const ip = await getRequestIp()

  const captcha = await verifyCaptcha(parsed.data.captchaToken, ip)
  if (!captcha.ok) return captcha

  return continueAsGuestWith(
    { authProvider, ip },
    { nickname: parsed.data.nickname, password: parsed.data.password },
  )
})
