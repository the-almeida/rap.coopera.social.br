import { ConflictError } from '@/shared/lib/errors/base'
import type { McProfileId, UserId, VulgoClaimId, VulgoId } from '@/shared/lib/ids'
import { err, ok, type Result } from '@/shared/lib/result'

/**
 * MC identity (docs/mvp-spec.md, "Vulgos and profiles").
 *
 * - Every account is an MC with one `McProfile`.
 * - Battles reference a `Vulgo` (stage name), never an account.
 * - A vulgo is owned by at most one profile; unclaimed vulgos are obtained
 *   through an approved `VulgoClaim`.
 */

export type McProfile = {
  id: McProfileId
  userId: UserId
  slug: string
  createdAt: Date
}

export type Vulgo = {
  id: VulgoId
  name: string
  slug: string
  /** null = unclaimed. */
  mcProfileId: McProfileId | null
  createdAt: Date
}

/** What other modules embed in their read models. */
export type VulgoSummary = {
  id: VulgoId
  name: string
  slug: string
  /** Slug of the owning MC profile, null while unclaimed. */
  ownerProfileSlug: string | null
}

export type VulgoClaimStatus = 'pending' | 'approved' | 'rejected'
export type VulgoClaimDecision = Exclude<VulgoClaimStatus, 'pending'>

export type VulgoClaim = {
  id: VulgoClaimId
  vulgoId: VulgoId
  mcProfileId: McProfileId
  status: VulgoClaimStatus
  decidedBy: UserId | null
  decidedAt: Date | null
  createdAt: Date
}

export const PROFILE_SLUG_FALLBACK = 'mc'

/** Only unclaimed vulgos can be requested. */
export function ensureClaimable(vulgo: Vulgo, profileId: McProfileId): Result<void, ConflictError> {
  if (vulgo.mcProfileId === profileId) return err(new ConflictError('this vulgo is already yours'))
  if (vulgo.mcProfileId !== null) {
    return err(new ConflictError('this vulgo already belongs to another MC'))
  }
  return ok(undefined)
}

/**
 * A claim can be decided once. Approving also requires the vulgo to still
 * be unclaimed (another MC's claim may have been approved meanwhile).
 */
export function ensureDecidable(
  claim: VulgoClaim,
  vulgo: Vulgo,
  decision: VulgoClaimDecision,
): Result<void, ConflictError> {
  if (claim.status !== 'pending') {
    return err(new ConflictError(`claim was already ${claim.status}`))
  }
  if (decision === 'approved' && vulgo.mcProfileId !== null) {
    return err(new ConflictError('this vulgo already belongs to an MC'))
  }
  return ok(undefined)
}
