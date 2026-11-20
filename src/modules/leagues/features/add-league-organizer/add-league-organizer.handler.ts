'use server'

import { ConflictError, NotFoundError, ValidationError } from '@/shared/lib/errors/base'
import { withErrorBoundary } from '@/shared/lib/errors/with-error-boundary'
import { rateLimit } from '@/shared/lib/rate-limit'
import { err, ok } from '@/shared/lib/result'

import { findUserProfileByLogin, requireUser } from '@/modules/auth'

import { leagueRepository } from '../../adapters/league-repository.drizzle'
import { leaguePolicy } from '../../domain/policy'

import { addLeagueOrganizerSchema } from './add-league-organizer.schema'

/** Admins turn an MC (any account) into an organizer of a league. */
export const addLeagueOrganizer = withErrorBoundary(async (raw: unknown) => {
  const userResult = await requireUser()
  if (!userResult.ok) return userResult
  const admin = userResult.value

  const parsed = addLeagueOrganizerSchema.safeParse(raw)
  if (!parsed.success) return err(new ValidationError(parsed.error.flatten()))

  const authz = leaguePolicy(admin, { type: 'manage-organizers' })
  if (!authz.ok) return authz

  // Lookups reveal whether an account exists; cap them.
  const limit = await rateLimit(`leagues:add-organizer:${admin.id}`, {
    windowMs: 60 * 60 * 1000,
    max: 60,
  })
  if (!limit.ok) return limit

  const league = await leagueRepository.findById(parsed.data.leagueId)
  if (!league) return err(new NotFoundError('league not found'))

  const mc = await findUserProfileByLogin(parsed.data.login)
  if (!mc) return err(new NotFoundError('no account uses this email or nickname'))

  const added = await leagueRepository.addOrganizer({
    leagueId: league.id,
    userId: mc.id,
    addedBy: admin.id,
  })
  if (!added) return err(new ConflictError('this MC already organizes the league'))
  return ok({ leagueId: league.id, userId: mc.id, name: mc.name, email: mc.email })
})
