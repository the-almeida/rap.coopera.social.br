import type { ForbiddenError, NotFoundError } from '@/shared/lib/errors/base'
import type { LeagueId } from '@/shared/lib/ids'
import { ok, type Result } from '@/shared/lib/result'

import { getUserProfiles, requireUser } from '@/modules/auth'

import { leagueRepository } from '../../adapters/league-repository.drizzle'
import { authorizeLeague, type RequireUserError } from '../../authorize'
import type { LeagueOrganizer } from '../../domain/league'

/** The league's organizers with name and email. Admins and co-organizers only. */
export async function listLeagueOrganizers(
  leagueId: LeagueId,
): Promise<Result<LeagueOrganizer[], RequireUserError | NotFoundError | ForbiddenError>> {
  const userResult = await requireUser()
  if (!userResult.ok) return userResult

  const access = await authorizeLeague(userResult.value, leagueId, 'view-organizers')
  if (!access.ok) return access

  const seats = await leagueRepository.listOrganizers(leagueId)
  const profiles = new Map(
    (await getUserProfiles(seats.map((s) => s.userId))).map((p) => [p.id, p]),
  )
  return ok(
    seats.flatMap((seat) => {
      const profile = profiles.get(seat.userId)
      return profile
        ? [
            {
              leagueId,
              userId: seat.userId,
              name: profile.name,
              email: profile.email,
              addedAt: seat.addedAt,
            },
          ]
        : []
    }),
  )
}
