import { and, count, desc, eq, inArray, ne, or } from 'drizzle-orm'

import type { EditionId, EntryId, LeagueId, VulgoId } from '@/shared/lib/ids'
import { db } from '@/shared/db/client'
import { battleRounds, battles, editionEntries, editions } from '@/shared/db/schema/editions'
import { leagues } from '@/shared/db/schema/leagues'

import type { Battle, BattleRound } from '../domain/bracket'
import type { Edition, Entry } from '../domain/edition'
import type { League } from '../domain/league'
import type { CrowdDraw } from '../domain/selection'
import type { Withdrawal } from '../domain/withdrawal'

import {
  selectBattles,
  selectDraws,
  selectEntries,
  selectRounds,
  selectWithdrawals,
} from './edition-repository.drizzle'
import { toBattle, toEdition, toEntry, toRound } from './mappers'

// The repository's own shape. No port in front: one implementation, tested
// against the local database (ADR-0007).

export type EditionSnapshot = {
  entries: Entry[]
  battles: Battle[]
  rounds: BattleRound[]
  withdrawals: Withdrawal[]
  draws: CrowdDraw[]
}

export type VulgoHistoryInput = {
  /** The vulgos' entries in editions that were not cancelled. */
  entries: (Entry & { edition: Edition; league: Pick<League, 'id' | 'name' | 'slug'> })[]
  /** Every battle of those editions (needed for outcomes and opponents). */
  battles: Battle[]
  /** Rounds of the battles those entries fought. */
  rounds: BattleRound[]
  /** entry -> vulgo for every entry of those editions (to name opponents). */
  entryVulgos: Map<EntryId, VulgoId>
}

/** Query side for pages, dashboards and the public API. */
export type LeagueReadModel = {
  listEditions(
    leagueId: LeagueId,
    paging: { page: number; perPage: number },
  ): Promise<{ items: (Edition & { entryCount: number })[]; total: number }>
  getEditionSnapshot(editionId: EditionId): Promise<EditionSnapshot>
  getVulgoHistoryInput(vulgoIds: readonly VulgoId[]): Promise<VulgoHistoryInput>
}

export const leagueReadModel: LeagueReadModel = {
  async listEditions(leagueId, { page, perPage }) {
    const entryCount = db
      .select({ editionId: editionEntries.editionId, total: count().as('total') })
      .from(editionEntries)
      .groupBy(editionEntries.editionId)
      .as('entry_count')
    const where = eq(editions.leagueId, leagueId)
    const [rows, [totals]] = await Promise.all([
      db
        .select({ edition: editions, entryCount: entryCount.total })
        .from(editions)
        .leftJoin(entryCount, eq(entryCount.editionId, editions.id))
        .where(where)
        .orderBy(desc(editions.eventDate), desc(editions.number))
        .limit(perPage)
        .offset((page - 1) * perPage),
      db.select({ total: count() }).from(editions).where(where),
    ])
    return {
      items: rows.map((row) => ({ ...toEdition(row.edition), entryCount: row.entryCount ?? 0 })),
      total: totals?.total ?? 0,
    }
  },

  async getEditionSnapshot(editionId) {
    const [entries, battleList, rounds, withdrawalList, draws] = await Promise.all([
      selectEntries(db, editionId),
      selectBattles(db, editionId),
      selectRounds(db, editionId),
      selectWithdrawals(db, editionId),
      selectDraws(db, editionId),
    ])
    return { entries, battles: battleList, rounds, withdrawals: withdrawalList, draws }
  },

  async getVulgoHistoryInput(vulgoIds) {
    if (vulgoIds.length === 0)
      return { entries: [], battles: [], rounds: [], entryVulgos: new Map() }
    const rows = await db
      .select({
        entry: editionEntries,
        edition: editions,
        league: { id: leagues.id, name: leagues.name, slug: leagues.slug },
      })
      .from(editionEntries)
      .innerJoin(editions, eq(editions.id, editionEntries.editionId))
      .innerJoin(leagues, eq(leagues.id, editions.leagueId))
      .where(and(inArray(editionEntries.vulgoId, [...vulgoIds]), ne(editions.status, 'cancelled')))
      .orderBy(desc(editions.eventDate), desc(editions.number))
    if (rows.length === 0) return { entries: [], battles: [], rounds: [], entryVulgos: new Map() }

    const editionIds = [...new Set(rows.map((row) => row.edition.id))]
    const entryIds = rows.map((row) => row.entry.id)
    const [battleRows, roundRows, entryRows] = await Promise.all([
      db.select().from(battles).where(inArray(battles.editionId, editionIds)),
      db
        .select({ round: battleRounds })
        .from(battleRounds)
        .innerJoin(battles, eq(battles.id, battleRounds.battleId))
        .where(or(inArray(battles.entryAId, entryIds), inArray(battles.entryBId, entryIds))),
      db
        .select({ id: editionEntries.id, vulgoId: editionEntries.vulgoId })
        .from(editionEntries)
        .where(inArray(editionEntries.editionId, editionIds)),
    ])
    return {
      entries: rows.map((row) => ({
        ...toEntry(row.entry),
        edition: toEdition(row.edition),
        league: row.league,
      })),
      battles: battleRows.map(toBattle),
      rounds: roundRows.map((row) => toRound(row.round)),
      entryVulgos: new Map(entryRows.map((row) => [row.id, row.vulgoId])),
    }
  },
}
