'use server'

import { isUniqueViolation } from '@/shared/db/errors'
import { ConflictError, ValidationError } from '@/shared/lib/errors/base'
import { withErrorBoundary } from '@/shared/lib/errors/with-error-boundary'
import { err, ok } from '@/shared/lib/result'
import { resolveUniqueSlug } from '@/shared/lib/slug'
import { Events } from '@/shared/observability/analytics/events'
import { track } from '@/shared/observability/analytics/track'

import { requireUser } from '@/modules/auth'

import { leagueRepository } from '../../adapters/league-repository.drizzle'
import { LEAGUE_SLUG_FALLBACK } from '../../domain/league'
import { leaguePolicy } from '../../domain/policy'

import { createLeagueSchema } from './create-league.schema'

/** Admins create leagues (then add organizers with `addLeagueOrganizer`). */
export const createLeague = withErrorBoundary(async (raw: unknown) => {
  const userResult = await requireUser()
  if (!userResult.ok) return userResult
  const user = userResult.value

  const parsed = createLeagueSchema.safeParse(raw)
  if (!parsed.success) return err(new ValidationError(parsed.error.flatten()))

  const authz = leaguePolicy(user, { type: 'create-league' })
  if (!authz.ok) return authz

  const slug = await resolveUniqueSlug({
    requested: parsed.data.slug,
    name: parsed.data.name,
    fallback: LEAGUE_SLUG_FALLBACK,
    findSlugsLike: leagueRepository.findSlugsLike,
  })
  if (!slug.ok) return slug

  try {
    const league = await leagueRepository.create({
      name: parsed.data.name,
      slug: slug.value,
      createdBy: user.id,
    })
    track(Events.LEAGUE_CREATED, {})
    return ok(league)
  } catch (error) {
    if (isUniqueViolation(error)) {
      return err(new ConflictError(`slug "${slug.value}" is already taken, try again`))
    }
    throw error
  }
})
