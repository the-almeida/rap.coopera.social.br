'use server'

import { ValidationError } from '@/shared/lib/errors/base'
import { withErrorBoundary } from '@/shared/lib/errors/with-error-boundary'
import { rateLimit } from '@/shared/lib/rate-limit'
import { err, ok } from '@/shared/lib/result'

import { requireUser } from '@/modules/auth'

import { mcRepository } from '../../adapters/mc-repository.drizzle'
import { mcPolicy } from '../../domain/policy'

import { searchVulgosSchema } from './search-vulgos.schema'

/**
 * Autocomplete while the organizer types the night's list, and for MCs
 * looking for a vulgo to claim. Accent/case-insensitive ("ze" finds "Zé").
 */
export const searchVulgos = withErrorBoundary(async (raw: unknown) => {
  const userResult = await requireUser()
  if (!userResult.ok) return userResult

  const parsed = searchVulgosSchema.safeParse(raw)
  if (!parsed.success) return err(new ValidationError(parsed.error.flatten()))

  const authz = mcPolicy(userResult.value, { type: 'search-vulgos' })
  if (!authz.ok) return authz

  // Typeahead fires per keystroke; the cap only stops scripted scraping.
  const limit = await rateLimit(`vulgos:search:${userResult.value.id}`, {
    windowMs: 60_000,
    max: 180,
  })
  if (!limit.ok) return limit

  return ok(await mcRepository.searchVulgos(parsed.data.query, parsed.data.limit))
})
