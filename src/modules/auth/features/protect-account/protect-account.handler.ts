'use server'

import { sendEmail } from '@/shared/lib/email'
import { ValidationError } from '@/shared/lib/errors/base'
import { withErrorBoundary } from '@/shared/lib/errors/with-error-boundary'
import { getRequestIp } from '@/shared/lib/http/request-ip'
import { rateLimit } from '@/shared/lib/rate-limit'
import { err } from '@/shared/lib/result'
import { Events } from '@/shared/observability/analytics/events'
import { track } from '@/shared/observability/analytics/track'

import { authProvider } from '../../adapters/auth-provider.supabase'
import { requireUser } from '../../require-user'

import { requestGuestEmailFor, verifyGuestEmailFor } from './protect-account.logic'
import { requestGuestEmailSchema, verifyGuestEmailSchema } from './protect-account.schema'

/**
 * Emails a code to the address a guest wants to add to its account. The
 * guest-only rule and the limit per address live in the logic.
 */
export const requestGuestEmail = withErrorBoundary(async (raw: unknown) => {
  const parsed = requestGuestEmailSchema.safeParse(raw)
  if (!parsed.success) return err(new ValidationError(parsed.error.flatten()))

  const userResult = await requireUser()
  if (!userResult.ok) return userResult

  const ipLimit = await rateLimit(`guest-email:request:ip:${await getRequestIp()}`, {
    windowMs: 10 * 60_000,
    max: 20,
  })
  if (!ipLimit.ok) return ipLimit
  // Each request sends an email: few per account, and they cost the
  // project's email quota.
  const limit = await rateLimit(`guest-email:request:${userResult.value.id}`, {
    windowMs: 10 * 60_000,
    max: 5,
  })
  if (!limit.ok) return limit

  return requestGuestEmailFor(userResult.value, parsed.data, { sendEmail })
})

/** Checks the emailed code and makes the address the account's email. */
export const verifyGuestEmail = withErrorBoundary(async (raw: unknown) => {
  const parsed = verifyGuestEmailSchema.safeParse(raw)
  if (!parsed.success) return err(new ValidationError(parsed.error.flatten()))

  const userResult = await requireUser()
  if (!userResult.ok) return userResult

  const ipLimit = await rateLimit(`guest-email:verify:ip:${await getRequestIp()}`, {
    windowMs: 10 * 60_000,
    max: 60,
  })
  if (!ipLimit.ok) return ipLimit
  // The code itself allows 5 tries; this also caps tries across new codes.
  const limit = await rateLimit(`guest-email:verify:${userResult.value.id}`, {
    windowMs: 10 * 60_000,
    max: 20,
  })
  if (!limit.ok) return limit

  const result = await verifyGuestEmailFor(userResult.value, parsed.data, { authProvider })
  if (result.ok) track(Events.ACCOUNT_PROTECTED, { method: 'email' })
  return result
})
