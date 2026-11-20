'use server'

import { NotFoundError, ValidationError } from '@/shared/lib/errors/base'
import { withErrorBoundary } from '@/shared/lib/errors/with-error-boundary'
import { err } from '@/shared/lib/result'
import { Events } from '@/shared/observability/analytics/events'
import { track } from '@/shared/observability/analytics/track'

import { isAdmin, requireUser } from '@/modules/auth'
import { applyVulgoClaimDecision, getVulgoClaim } from '@/modules/mcs'

import { leagueRepository } from '../../adapters/league-repository.drizzle'
import { leaguePolicy } from '../../domain/policy'

import { decideVulgoClaimSchema } from './decide-vulgo-claim.schema'

/**
 * Approves or rejects an MC's request to own a vulgo. Admins, or organizers
 * of a league where that vulgo has an entry. Approving moves the vulgo's
 * whole history to the MC and rejects competing claims on it.
 */
export const decideVulgoClaim = withErrorBoundary(async (raw: unknown) => {
  const userResult = await requireUser()
  if (!userResult.ok) return userResult
  const user = userResult.value

  const parsed = decideVulgoClaimSchema.safeParse(raw)
  if (!parsed.success) return err(new ValidationError(parsed.error.flatten()))

  const claim = await getVulgoClaim(parsed.data.claimId)
  if (!claim) return err(new NotFoundError('claim not found'))

  const authz = leaguePolicy(user, {
    type: 'review-vulgo-claim',
    organizesLeagueWhereVulgoBattled:
      isAdmin(user) || (await leagueRepository.organizesLeagueWithVulgo(user.id, claim.vulgoId)),
  })
  if (!authz.ok) return authz

  const decided = await applyVulgoClaimDecision({
    claimId: claim.id,
    decision: parsed.data.decision,
    decidedBy: user.id,
  })
  if (decided.ok) track(Events.VULGO_CLAIM_DECIDED, { decision: parsed.data.decision })
  return decided
})
