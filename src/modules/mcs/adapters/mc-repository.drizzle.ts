import { and, asc, eq, ilike, inArray, like, ne, or } from 'drizzle-orm'

import type { Result } from '@/shared/lib/result'
import type { McProfileId, UserId, VulgoClaimId, VulgoId } from '@/shared/lib/ids'
import { db, type DbExecutor } from '@/shared/db/client'
import {
  mcProfiles,
  type McProfileRow,
  vulgoClaims,
  type VulgoClaimRow,
  vulgos,
  type VulgoRow,
} from '@/shared/db/schema/mcs'
import { transactionWithResult } from '@/shared/db/transaction'
import { slugify } from '@/shared/lib/slug'

import type { McProfile, Vulgo, VulgoClaim, VulgoClaimDecision, VulgoSummary } from '../domain/mc'

// The repository's own shape. No port in front: one implementation, tested
// against the local database (ADR-0007).

export type McRepository = {
  findProfileByUserId(userId: UserId): Promise<McProfile | null>
  findProfileBySlug(slug: string): Promise<McProfile | null>
  findProfilesByIds(ids: readonly McProfileId[]): Promise<McProfile[]>
  /** Existing profile slugs equal to `base` or shaped like `base-<n>`. */
  findProfileSlugsLike(base: string): Promise<string[]>
  /** Throws on unique violation (user already has a profile / slug taken). */
  insertProfile(input: { userId: UserId; slug: string }): Promise<McProfile>

  findVulgoById(id: VulgoId): Promise<Vulgo | null>
  findVulgoBySlug(slug: string): Promise<Vulgo | null>
  /** Locks the vulgo row until the surrounding transaction ends. */
  lockVulgo(id: VulgoId): Promise<Vulgo | null>
  findVulgoSummaries(ids: readonly VulgoId[]): Promise<VulgoSummary[]>
  searchVulgos(query: string, limit: number): Promise<VulgoSummary[]>
  listVulgosByProfile(profileId: McProfileId): Promise<Vulgo[]>
  /** Inserts unless the slug exists; returns null when it already existed. */
  insertVulgoIfAbsent(input: {
    name: string
    slug: string
    mcProfileId: McProfileId | null
    createdBy: UserId
  }): Promise<Vulgo | null>
  setVulgoOwner(id: VulgoId, profileId: McProfileId): Promise<void>

  findClaimById(id: VulgoClaimId): Promise<VulgoClaim | null>
  /** Returns null when the MC already has a pending claim for this vulgo. */
  insertClaimIfAbsent(input: {
    vulgoId: VulgoId
    mcProfileId: McProfileId
  }): Promise<VulgoClaim | null>
  listClaimsByProfile(profileId: McProfileId): Promise<VulgoClaim[]>
  /** Pending claims, optionally restricted to some vulgos; oldest first. */
  listPendingClaims(filter: { vulgoIds?: readonly VulgoId[] }): Promise<VulgoClaim[]>
  decideClaim(
    id: VulgoClaimId,
    decision: VulgoClaimDecision,
    decidedBy: UserId,
  ): Promise<VulgoClaim>
  /** Rejects the other pending claims on a vulgo that was just given away. */
  rejectOtherPendingClaims(
    vulgoId: VulgoId,
    exceptId: VulgoClaimId,
    decidedBy: UserId,
  ): Promise<void>

  /** Runs `fn` in a transaction; `err` results roll back. */
  transaction<R extends Result<unknown, unknown>>(
    fn: (repo: McRepository) => Promise<R>,
  ): Promise<R>
}

function toProfile(row: McProfileRow): McProfile {
  return { id: row.id, userId: row.userId, slug: row.slug, createdAt: row.createdAt }
}

function toVulgo(row: VulgoRow): Vulgo {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    mcProfileId: row.mcProfileId,
    createdAt: row.createdAt,
  }
}

function toClaim(row: VulgoClaimRow): VulgoClaim {
  return {
    id: row.id,
    vulgoId: row.vulgoId,
    mcProfileId: row.mcProfileId,
    status: row.status,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    createdAt: row.createdAt,
  }
}

/** Escapes LIKE wildcards so user input is matched literally. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

function makeRepository(executor: DbExecutor): McRepository {
  const summaries = () =>
    executor
      .select({
        id: vulgos.id,
        name: vulgos.name,
        slug: vulgos.slug,
        ownerProfileSlug: mcProfiles.slug,
      })
      .from(vulgos)
      .leftJoin(mcProfiles, eq(mcProfiles.id, vulgos.mcProfileId))

  const repo: McRepository = {
    async findProfileByUserId(userId) {
      const [row] = await executor.select().from(mcProfiles).where(eq(mcProfiles.userId, userId))
      return row ? toProfile(row) : null
    },
    async findProfileBySlug(slug) {
      const [row] = await executor.select().from(mcProfiles).where(eq(mcProfiles.slug, slug))
      return row ? toProfile(row) : null
    },
    async findProfilesByIds(ids) {
      if (ids.length === 0) return []
      const rows = await executor
        .select()
        .from(mcProfiles)
        .where(inArray(mcProfiles.id, [...ids]))
      return rows.map(toProfile)
    },
    async findProfileSlugsLike(base) {
      const rows = await executor
        .select({ slug: mcProfiles.slug })
        .from(mcProfiles)
        .where(or(eq(mcProfiles.slug, base), like(mcProfiles.slug, `${base}-%`)))
      return rows.map((row) => row.slug)
    },
    async insertProfile(input) {
      const [row] = await executor.insert(mcProfiles).values(input).returning()
      if (!row) throw new Error('mc profile insert returned no rows')
      return toProfile(row)
    },

    async findVulgoById(id) {
      const [row] = await executor.select().from(vulgos).where(eq(vulgos.id, id))
      return row ? toVulgo(row) : null
    },
    async findVulgoBySlug(slug) {
      const [row] = await executor.select().from(vulgos).where(eq(vulgos.slug, slug))
      return row ? toVulgo(row) : null
    },
    async lockVulgo(id) {
      const [row] = await executor.select().from(vulgos).where(eq(vulgos.id, id)).for('update')
      return row ? toVulgo(row) : null
    },
    async findVulgoSummaries(ids) {
      if (ids.length === 0) return []
      return summaries().where(inArray(vulgos.id, [...ids]))
    },
    async searchVulgos(query, limit) {
      // Names carry accents ("Zé"); slugs don't. Matching both makes "ze"
      // find "Zé" without the unaccent extension.
      const slugQuery = slugify(query)
      const conditions = [ilike(vulgos.name, `%${escapeLike(query)}%`)]
      if (slugQuery) conditions.push(like(vulgos.slug, `%${slugQuery}%`))
      return summaries()
        .where(or(...conditions))
        .orderBy(asc(vulgos.name))
        .limit(limit)
    },
    async listVulgosByProfile(profileId) {
      const rows = await executor
        .select()
        .from(vulgos)
        .where(eq(vulgos.mcProfileId, profileId))
        .orderBy(asc(vulgos.createdAt))
      return rows.map(toVulgo)
    },
    async insertVulgoIfAbsent(input) {
      const [row] = await executor
        .insert(vulgos)
        .values(input)
        .onConflictDoNothing({ target: vulgos.slug })
        .returning()
      return row ? toVulgo(row) : null
    },
    async setVulgoOwner(id, profileId) {
      await executor
        .update(vulgos)
        .set({ mcProfileId: profileId, updatedAt: new Date() })
        .where(eq(vulgos.id, id))
    },

    async findClaimById(id) {
      const [row] = await executor.select().from(vulgoClaims).where(eq(vulgoClaims.id, id))
      return row ? toClaim(row) : null
    },
    async insertClaimIfAbsent(input) {
      const [row] = await executor
        .insert(vulgoClaims)
        .values(input)
        .onConflictDoNothing()
        .returning()
      return row ? toClaim(row) : null
    },
    async listClaimsByProfile(profileId) {
      const rows = await executor
        .select()
        .from(vulgoClaims)
        .where(eq(vulgoClaims.mcProfileId, profileId))
        .orderBy(asc(vulgoClaims.createdAt))
      return rows.map(toClaim)
    },
    async listPendingClaims({ vulgoIds }) {
      if (vulgoIds && vulgoIds.length === 0) return []
      const rows = await executor
        .select()
        .from(vulgoClaims)
        .where(
          and(
            eq(vulgoClaims.status, 'pending'),
            vulgoIds ? inArray(vulgoClaims.vulgoId, [...vulgoIds]) : undefined,
          ),
        )
        .orderBy(asc(vulgoClaims.createdAt))
      return rows.map(toClaim)
    },
    async decideClaim(id, decision, decidedBy) {
      const [row] = await executor
        .update(vulgoClaims)
        .set({ status: decision, decidedBy, decidedAt: new Date() })
        .where(eq(vulgoClaims.id, id))
        .returning()
      if (!row) throw new Error('claim update returned no rows')
      return toClaim(row)
    },
    async rejectOtherPendingClaims(vulgoId, exceptId, decidedBy) {
      await executor
        .update(vulgoClaims)
        .set({ status: 'rejected', decidedBy, decidedAt: new Date() })
        .where(
          and(
            eq(vulgoClaims.vulgoId, vulgoId),
            eq(vulgoClaims.status, 'pending'),
            ne(vulgoClaims.id, exceptId),
          ),
        )
    },

    transaction(fn) {
      return transactionWithResult((tx) => fn(makeRepository(tx)))
    },
  }
  return repo
}

export const mcRepository = makeRepository(db)
