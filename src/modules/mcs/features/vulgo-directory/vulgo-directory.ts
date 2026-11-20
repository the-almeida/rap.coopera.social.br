import { NotFoundError, ValidationError } from '@/shared/lib/errors/base'
import type { McProfileId, UserId, VulgoClaimId, VulgoId } from '@/shared/lib/ids'
import { err, ok, type Result } from '@/shared/lib/result'
import { slugify } from '@/shared/lib/slug'
import { slugSchema } from '@/shared/lib/validation'

import type { User } from '@/modules/auth'

import { mcRepository } from '../../adapters/mc-repository.drizzle'
import {
  ensureDecidable,
  type McProfile,
  type Vulgo,
  type VulgoClaim,
  type VulgoClaimDecision,
  type VulgoSummary,
} from '../../domain/mc'
import { ensureMcProfile } from '../ensure-mc-profile/ensure-mc-profile'

/**
 * Server-side functions other modules (and Server Components) use. None of
 * these is a server action: they are not reachable from the browser.
 * Functions that mutate (`findOrCreateVulgo`, `applyVulgoClaimDecision`)
 * do NOT authorize; callers must run their own policy first.
 */

export const VULGO_NAME_MAX_LENGTH = 60

/**
 * The vulgo an organizer typed: the existing one with the same identity
 * (accent/case-insensitive), or a new unclaimed one.
 */
export async function findOrCreateVulgo(input: {
  name: string
  createdBy: UserId
}): Promise<Result<Vulgo, ValidationError>> {
  const name = input.name.trim().replace(/\s+/g, ' ')
  const slug = slugify(name)
  if (!slug || name.length > VULGO_NAME_MAX_LENGTH) {
    return err(
      new ValidationError(
        {
          formErrors: [],
          fieldErrors: { vulgoName: ['must contain letters or digits (max 60 characters)'] },
        },
        'Invalid vulgo',
      ),
    )
  }
  const created = await mcRepository.insertVulgoIfAbsent({
    name,
    slug,
    mcProfileId: null,
    createdBy: input.createdBy,
  })
  if (created) return ok(created)
  const existing = await mcRepository.findVulgoBySlug(slug)
  if (!existing) throw new Error('vulgo vanished between insert and read')
  return ok(existing)
}

export function getVulgoById(id: VulgoId): Promise<Vulgo | null> {
  return mcRepository.findVulgoById(id)
}

export async function getVulgoBySlug(slug: string): Promise<Vulgo | null> {
  if (!slugSchema.safeParse(slug).success) return null
  return mcRepository.findVulgoBySlug(slug)
}

export function getVulgoSummaries(ids: readonly VulgoId[]): Promise<VulgoSummary[]> {
  return mcRepository.findVulgoSummaries([...new Set(ids)])
}

/** Public MC page: the profile and the vulgos it owns. */
export async function getMcProfileBySlug(
  slug: string,
): Promise<{ profile: McProfile; vulgos: Vulgo[] } | null> {
  if (!slugSchema.safeParse(slug).success) return null
  const profile = await mcRepository.findProfileBySlug(slug)
  if (!profile) return null
  return { profile, vulgos: await mcRepository.listVulgosByProfile(profile.id) }
}

export type MyMcIdentity = {
  profile: McProfile
  vulgos: Vulgo[]
  claims: (VulgoClaim & { vulgo: VulgoSummary })[]
}

/** The signed-in MC's profile (created on first use), vulgos and claims. */
export async function getMyMcIdentity(user: Pick<User, 'id' | 'name'>): Promise<MyMcIdentity> {
  const profile = await ensureMcProfile(user)
  const [vulgos, claims] = await Promise.all([
    mcRepository.listVulgosByProfile(profile.id),
    mcRepository.listClaimsByProfile(profile.id),
  ])
  const summaries = new Map(
    (await getVulgoSummaries(claims.map((c) => c.vulgoId))).map((v) => [v.id, v]),
  )
  return {
    profile,
    vulgos,
    claims: claims.flatMap((claim) => {
      const vulgo = summaries.get(claim.vulgoId)
      return vulgo ? [{ ...claim, vulgo }] : []
    }),
  }
}

export function getVulgoClaim(id: VulgoClaimId): Promise<VulgoClaim | null> {
  return mcRepository.findClaimById(id)
}

export type PendingVulgoClaim = VulgoClaim & {
  vulgo: VulgoSummary
  claimant: { profileId: McProfileId; profileSlug: string; userId: UserId }
}

/** Pending claims (all, or only for some vulgos), oldest first. */
export async function listPendingVulgoClaims(
  filter: { vulgoIds?: readonly VulgoId[] } = {},
): Promise<PendingVulgoClaim[]> {
  const claims = await mcRepository.listPendingClaims(filter)
  const vulgos = new Map(
    (await getVulgoSummaries(claims.map((c) => c.vulgoId))).map((v) => [v.id, v]),
  )
  const profiles = new Map(
    (await mcRepository.findProfilesByIds([...new Set(claims.map((c) => c.mcProfileId))])).map(
      (p) => [p.id, p],
    ),
  )
  return claims.flatMap((claim) => {
    const vulgo = vulgos.get(claim.vulgoId)
    const profile = profiles.get(claim.mcProfileId)
    if (!vulgo || !profile) return []
    return [
      {
        ...claim,
        vulgo,
        claimant: { profileId: profile.id, profileSlug: profile.slug, userId: profile.userId },
      },
    ]
  })
}

/**
 * Applies an already-authorized decision. Approving gives the vulgo (and
 * its whole history) to the claimant and rejects the other pending claims
 * on the same vulgo.
 */
export async function applyVulgoClaimDecision(input: {
  claimId: VulgoClaimId
  decision: VulgoClaimDecision
  decidedBy: UserId
}) {
  return mcRepository.transaction(async (repo) => {
    const claim = await repo.findClaimById(input.claimId)
    if (!claim) return err(new NotFoundError('claim not found'))
    const vulgo = await repo.lockVulgo(claim.vulgoId)
    if (!vulgo) return err(new NotFoundError('vulgo not found'))

    const decidable = ensureDecidable(claim, vulgo, input.decision)
    if (!decidable.ok) return decidable

    const decided = await repo.decideClaim(claim.id, input.decision, input.decidedBy)
    if (input.decision === 'approved') {
      await repo.setVulgoOwner(vulgo.id, claim.mcProfileId)
      await repo.rejectOtherPendingClaims(vulgo.id, claim.id, input.decidedBy)
    }
    return ok(decided)
  })
}
