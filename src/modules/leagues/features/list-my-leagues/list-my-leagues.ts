import { ok, type Result } from '@/shared/lib/result'

import { isAdmin, requireUser } from '@/modules/auth'

import { leagueRepository } from '../../adapters/league-repository.drizzle'
import type { RequireUserError } from '../../authorize'
import type { League } from '../../domain/league'

/**
 * Leagues the caller can run: every league for admins, the leagues they
 * organize otherwise. Server-only function for Server Components.
 */
export async function listMyLeagues(): Promise<Result<League[], RequireUserError>> {
  const userResult = await requireUser()
  if (!userResult.ok) return userResult
  const user = userResult.value
  return ok(
    isAdmin(user)
      ? await leagueRepository.listAll()
      : await leagueRepository.listForOrganizer(user.id),
  )
}
