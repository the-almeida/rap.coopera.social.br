'use server'

import { NotFoundError, ValidationError } from '@/shared/lib/errors/base'
import { withErrorBoundary } from '@/shared/lib/errors/with-error-boundary'
import { err, ok } from '@/shared/lib/result'

import { requireUser } from '@/modules/auth'

import { leagueRepository } from '../../adapters/league-repository.drizzle'
import { leaguePolicy } from '../../domain/policy'

import { removeLeagueOrganizerSchema } from './remove-league-organizer.schema'

/** Admins remove an organizer from a league. Their battle history is untouched. */
export const removeLeagueOrganizer = withErrorBoundary(async (raw: unknown) => {
  const userResult = await requireUser()
  if (!userResult.ok) return userResult

  const parsed = removeLeagueOrganizerSchema.safeParse(raw)
  if (!parsed.success) return err(new ValidationError(parsed.error.flatten()))

  const authz = leaguePolicy(userResult.value, { type: 'manage-organizers' })
  if (!authz.ok) return authz

  const removed = await leagueRepository.removeOrganizer(parsed.data.leagueId, parsed.data.userId)
  if (!removed) return err(new NotFoundError('this MC does not organize the league'))
  return ok(undefined)
})
