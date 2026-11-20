import { and, asc, eq, like, or, sql } from 'drizzle-orm'

import type { LeagueId, UserId, VulgoId } from '@/shared/lib/ids'
import { db } from '@/shared/db/client'
import { editionEntries, editions } from '@/shared/db/schema/editions'
import { leagueOrganizers, leagues } from '@/shared/db/schema/leagues'

import type { League } from '../domain/league'

import { toLeague } from './mappers'

// The repository's own shape. No port in front: one implementation, tested
// against the local database (ADR-0007).

export type LeagueRepository = {
  findById(id: LeagueId): Promise<League | null>
  findBySlug(slug: string): Promise<League | null>
  /** Existing slugs equal to `base` or shaped like `base-<n>`. */
  findSlugsLike(base: string): Promise<string[]>
  /** Throws on slug conflict. */
  create(input: { name: string; slug: string; createdBy: UserId }): Promise<League>
  listAll(): Promise<League[]>
  listForOrganizer(userId: UserId): Promise<League[]>

  isOrganizer(leagueId: LeagueId, userId: UserId): Promise<boolean>
  listOrganizers(leagueId: LeagueId): Promise<{ userId: UserId; addedAt: Date }[]>
  /** false when the user already organizes the league. */
  addOrganizer(input: { leagueId: LeagueId; userId: UserId; addedBy: UserId }): Promise<boolean>
  /** false when the user was not an organizer. */
  removeOrganizer(leagueId: LeagueId, userId: UserId): Promise<boolean>

  /** Whether `userId` organizes a league where `vulgoId` has an entry. */
  organizesLeagueWithVulgo(userId: UserId, vulgoId: VulgoId): Promise<boolean>
  /** Every vulgo with an entry in a league `userId` organizes. */
  vulgosInLeaguesOrganizedBy(userId: UserId): Promise<VulgoId[]>
}

export const leagueRepository: LeagueRepository = {
  async findById(id) {
    const [row] = await db.select().from(leagues).where(eq(leagues.id, id))
    return row ? toLeague(row) : null
  },
  async findBySlug(slug) {
    const [row] = await db.select().from(leagues).where(eq(leagues.slug, slug))
    return row ? toLeague(row) : null
  },
  async findSlugsLike(base) {
    const rows = await db
      .select({ slug: leagues.slug })
      .from(leagues)
      .where(or(eq(leagues.slug, base), like(leagues.slug, `${base}-%`)))
    return rows.map((row) => row.slug)
  },
  async create(input) {
    const [row] = await db.insert(leagues).values(input).returning()
    if (!row) throw new Error('league insert returned no rows')
    return toLeague(row)
  },
  async listAll() {
    const rows = await db.select().from(leagues).orderBy(asc(leagues.name))
    return rows.map(toLeague)
  },
  async listForOrganizer(userId) {
    const rows = await db
      .select({ league: leagues })
      .from(leagueOrganizers)
      .innerJoin(leagues, eq(leagues.id, leagueOrganizers.leagueId))
      .where(eq(leagueOrganizers.userId, userId))
      .orderBy(asc(leagues.name))
    return rows.map((row) => toLeague(row.league))
  },

  async isOrganizer(leagueId, userId) {
    const [row] = await db
      .select({ userId: leagueOrganizers.userId })
      .from(leagueOrganizers)
      .where(and(eq(leagueOrganizers.leagueId, leagueId), eq(leagueOrganizers.userId, userId)))
    return Boolean(row)
  },
  async listOrganizers(leagueId) {
    return db
      .select({ userId: leagueOrganizers.userId, addedAt: leagueOrganizers.createdAt })
      .from(leagueOrganizers)
      .where(eq(leagueOrganizers.leagueId, leagueId))
      .orderBy(asc(leagueOrganizers.createdAt))
  },
  async addOrganizer(input) {
    const rows = await db
      .insert(leagueOrganizers)
      .values(input)
      .onConflictDoNothing()
      .returning({ userId: leagueOrganizers.userId })
    return rows.length > 0
  },
  async removeOrganizer(leagueId, userId) {
    const rows = await db
      .delete(leagueOrganizers)
      .where(and(eq(leagueOrganizers.leagueId, leagueId), eq(leagueOrganizers.userId, userId)))
      .returning({ userId: leagueOrganizers.userId })
    return rows.length > 0
  },

  async organizesLeagueWithVulgo(userId, vulgoId) {
    const [row] = await db
      .select({ one: sql<number>`1` })
      .from(editionEntries)
      .innerJoin(editions, eq(editions.id, editionEntries.editionId))
      .innerJoin(
        leagueOrganizers,
        and(eq(leagueOrganizers.leagueId, editions.leagueId), eq(leagueOrganizers.userId, userId)),
      )
      .where(eq(editionEntries.vulgoId, vulgoId))
      .limit(1)
    return Boolean(row)
  },
  async vulgosInLeaguesOrganizedBy(userId) {
    const rows = await db
      .selectDistinct({ vulgoId: editionEntries.vulgoId })
      .from(editionEntries)
      .innerJoin(editions, eq(editions.id, editionEntries.editionId))
      .innerJoin(
        leagueOrganizers,
        and(eq(leagueOrganizers.leagueId, editions.leagueId), eq(leagueOrganizers.userId, userId)),
      )
    return rows.map((row) => row.vulgoId)
  },
}
