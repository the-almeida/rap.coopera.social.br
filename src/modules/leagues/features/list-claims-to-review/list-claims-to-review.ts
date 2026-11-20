import { ok, type Result } from '@/shared/lib/result'

import { getUserProfiles, isAdmin, requireUser } from '@/modules/auth'
import { listPendingVulgoClaims, type PendingVulgoClaim } from '@/modules/mcs'

import { leagueRepository } from '../../adapters/league-repository.drizzle'
import type { RequireUserError } from '../../authorize'

export type ClaimToReview = PendingVulgoClaim & { claimantName: string | null }

/**
 * Pending vulgo claims the caller may decide: all of them for admins; for
 * organizers, claims on vulgos that have an entry in a league they organize.
 * Oldest first. Server-only function for Server Components.
 */
export async function listClaimsToReview(): Promise<Result<ClaimToReview[], RequireUserError>> {
  const userResult = await requireUser()
  if (!userResult.ok) return userResult
  const user = userResult.value

  const claims = isAdmin(user)
    ? await listPendingVulgoClaims()
    : await listPendingVulgoClaims({
        vulgoIds: await leagueRepository.vulgosInLeaguesOrganizedBy(user.id),
      })
  const names = new Map(
    (await getUserProfiles(claims.map((c) => c.claimant.userId))).map((p) => [p.id, p.name]),
  )
  return ok(claims.map((c) => ({ ...c, claimantName: names.get(c.claimant.userId) ?? null })))
}
