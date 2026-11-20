import { isUniqueViolation } from '@/shared/db/errors'
import { ok } from '@/shared/lib/result'
import { resolveUniqueSlug, slugify } from '@/shared/lib/slug'

import type { User } from '@/modules/auth'

import { mcRepository } from '../../adapters/mc-repository.drizzle'
import { type McProfile, PROFILE_SLUG_FALLBACK } from '../../domain/mc'

/**
 * Every account is an MC (docs/mvp-spec.md). Profiles are created lazily,
 * the first time an MC-facing feature needs one (dashboard, claims), so no
 * sign-up path (password, OTP, OAuth) can forget to create it. Idempotent
 * and safe under concurrent calls.
 *
 * The sign-up name becomes the MC's first vulgo, with one guard: if that
 * vulgo already exists (an organizer typed it at a past battle), it is NOT
 * handed over, since anyone could then take an MC's history by signing up
 * with their name. Instead a pending claim is opened for organizers to
 * review. If the name is already owned by another MC, nothing is assigned.
 */
export async function ensureMcProfile(user: Pick<User, 'id' | 'name'>): Promise<McProfile> {
  const existing = await mcRepository.findProfileByUserId(user.id)
  if (existing) return existing

  try {
    const created = await mcRepository.transaction(async (repo) => {
      const slug = await resolveUniqueSlug({
        requested: undefined,
        name: user.name,
        fallback: PROFILE_SLUG_FALLBACK,
        findSlugsLike: repo.findProfileSlugsLike,
      })
      if (!slug.ok) return slug
      const profile = await repo.insertProfile({ userId: user.id, slug: slug.value })

      const vulgoSlug = slugify(user.name)
      if (vulgoSlug) {
        const own = await repo.insertVulgoIfAbsent({
          name: user.name.trim(),
          slug: vulgoSlug,
          mcProfileId: profile.id,
          createdBy: user.id,
        })
        if (!own) {
          const taken = await repo.findVulgoBySlug(vulgoSlug)
          if (taken && taken.mcProfileId === null) {
            await repo.insertClaimIfAbsent({ vulgoId: taken.id, mcProfileId: profile.id })
          }
        }
      }
      return ok(profile)
    })
    if (created.ok) return created.value
  } catch (error) {
    // A concurrent call created the profile first: use theirs.
    if (!isUniqueViolation(error)) throw error
  }

  const raced = await mcRepository.findProfileByUserId(user.id)
  if (!raced) throw new Error('could not create the MC profile')
  return raced
}
