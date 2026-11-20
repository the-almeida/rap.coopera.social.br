'use server'

import { ConflictError, NotFoundError, ValidationError } from '@/shared/lib/errors/base'
import { withErrorBoundary } from '@/shared/lib/errors/with-error-boundary'
import { rateLimit } from '@/shared/lib/rate-limit'
import { err, ok } from '@/shared/lib/result'

import { requireUser } from '@/modules/auth'

import { mcRepository } from '../../adapters/mc-repository.drizzle'
import { ensureClaimable } from '../../domain/mc'
import { mcPolicy } from '../../domain/policy'
import { ensureMcProfile } from '../ensure-mc-profile/ensure-mc-profile'

import { requestVulgoClaimSchema } from './request-vulgo-claim.schema'

/**
 * The signed-in MC asks to own an unclaimed vulgo (and its history).
 * Admins, or organizers of a league where the vulgo battled, decide
 * (`decideVulgoClaim` in the leagues module).
 */
export const requestVulgoClaim = withErrorBoundary(async (raw: unknown) => {
  const userResult = await requireUser()
  if (!userResult.ok) return userResult
  const user = userResult.value

  const parsed = requestVulgoClaimSchema.safeParse(raw)
  if (!parsed.success) return err(new ValidationError(parsed.error.flatten()))

  const authz = mcPolicy(user, { type: 'request-vulgo-claim' })
  if (!authz.ok) return authz

  const limit = await rateLimit(`vulgos:claim:${user.id}`, { windowMs: 60 * 60 * 1000, max: 10 })
  if (!limit.ok) return limit

  const profile = await ensureMcProfile(user)

  return mcRepository.transaction(async (repo) => {
    const vulgo = await repo.lockVulgo(parsed.data.vulgoId)
    if (!vulgo) return err(new NotFoundError('vulgo not found'))

    const claimable = ensureClaimable(vulgo, profile.id)
    if (!claimable.ok) return claimable

    const claim = await repo.insertClaimIfAbsent({ vulgoId: vulgo.id, mcProfileId: profile.id })
    if (!claim) return err(new ConflictError('you already requested this vulgo'))
    return ok(claim)
  })
})
