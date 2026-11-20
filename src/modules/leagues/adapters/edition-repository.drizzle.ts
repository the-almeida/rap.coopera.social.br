import { and, asc, eq, inArray, sql } from 'drizzle-orm'

import { db, type DbExecutor } from '@/shared/db/client'
import {
  battleRounds,
  battles,
  crowdDraws,
  crowdDrawTickets,
  editionEntries,
  editions,
  withdrawals,
} from '@/shared/db/schema/editions'
import { leagues } from '@/shared/db/schema/leagues'
import { transactionWithResult } from '@/shared/db/transaction'
import { NotFoundError } from '@/shared/lib/errors/base'
import type { EditionId } from '@/shared/lib/ids'
import { err, type Result } from '@/shared/lib/result'

import type { EditionRepository, EditionUnitOfWork } from './edition-unit-of-work'
import { toBattle, toDraw, toEdition, toEntry, toRound, toWithdrawal } from './mappers'

export async function selectEntries(executor: DbExecutor, editionId: EditionId) {
  const rows = await executor
    .select()
    .from(editionEntries)
    .where(eq(editionEntries.editionId, editionId))
    .orderBy(asc(editionEntries.number))
  return rows.map(toEntry)
}

export async function selectBattles(executor: DbExecutor, editionId: EditionId) {
  const rows = await executor
    .select()
    .from(battles)
    .where(eq(battles.editionId, editionId))
    .orderBy(asc(battles.phase), asc(battles.position))
  return rows.map(toBattle)
}

export async function selectRounds(executor: DbExecutor, editionId: EditionId) {
  const rows = await executor
    .select({ round: battleRounds })
    .from(battleRounds)
    .innerJoin(battles, eq(battles.id, battleRounds.battleId))
    .where(eq(battles.editionId, editionId))
    .orderBy(asc(battleRounds.battleId), asc(battleRounds.roundNo))
  return rows.map((row) => toRound(row.round))
}

export async function selectDraws(executor: DbExecutor, editionId: EditionId) {
  const [draws, tickets] = await Promise.all([
    executor
      .select()
      .from(crowdDraws)
      .where(eq(crowdDraws.editionId, editionId))
      .orderBy(asc(crowdDraws.createdAt)),
    executor.select().from(crowdDrawTickets).where(eq(crowdDrawTickets.editionId, editionId)),
  ])
  return draws.map((draw) => toDraw(draw, tickets))
}

export async function selectWithdrawals(executor: DbExecutor, editionId: EditionId) {
  const rows = await executor
    .select()
    .from(withdrawals)
    .where(eq(withdrawals.editionId, editionId))
    .orderBy(asc(withdrawals.recordedAt))
  return rows.map(toWithdrawal)
}

function makeUnitOfWork(tx: DbExecutor, edition: EditionUnitOfWork['edition']): EditionUnitOfWork {
  const editionId = edition.id
  return {
    edition,
    async updateEdition(patch) {
      const [row] = await tx
        .update(editions)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(editions.id, editionId))
        .returning()
      if (!row) throw new Error('edition update returned no rows')
      return toEdition(row)
    },

    listEntries: () => selectEntries(tx, editionId),
    async appendEntry(vulgoId) {
      const [next] = await tx
        .select({ number: sql<number>`COALESCE(MAX(${editionEntries.number}), 0)::int + 1` })
        .from(editionEntries)
        .where(eq(editionEntries.editionId, editionId))
      const [row] = await tx
        .insert(editionEntries)
        .values({ editionId, vulgoId, number: next?.number ?? 1 })
        .returning()
      if (!row) throw new Error('entry insert returned no rows')
      return toEntry(row)
    },
    async removeEntry(id) {
      const [removed] = await tx
        .delete(editionEntries)
        .where(and(eq(editionEntries.id, id), eq(editionEntries.editionId, editionId)))
        .returning({ number: editionEntries.number })
      if (!removed) return
      await tx
        .update(editionEntries)
        .set({ number: sql`${editionEntries.number} - 1` })
        .where(
          and(
            eq(editionEntries.editionId, editionId),
            sql`${editionEntries.number} > ${removed.number}`,
          ),
        )
    },
    async moveEntry(id, to) {
      const [current] = await tx
        .select({ number: editionEntries.number })
        .from(editionEntries)
        .where(and(eq(editionEntries.id, id), eq(editionEntries.editionId, editionId)))
      if (!current || current.number === to) return
      const from = current.number
      // One statement permuting the numbers; the (edition_id, number)
      // constraint is DEFERRABLE, so it is checked after the whole update.
      await tx.execute(sql`
        UPDATE edition_entries SET number = CASE
          WHEN id = ${id} THEN ${to}
          WHEN ${to}::int < ${from}::int AND number >= ${to} AND number < ${from} THEN number + 1
          WHEN ${to}::int > ${from}::int AND number > ${from} AND number <= ${to} THEN number - 1
          ELSE number
        END, updated_at = now()
        WHERE edition_id = ${editionId}
      `)
    },
    async setEntryStates(updates) {
      const now = new Date()
      for (const update of updates) {
        await tx
          .update(editionEntries)
          .set({ status: update.status, selectedBy: update.selectedBy, updatedAt: now })
          .where(and(eq(editionEntries.id, update.id), eq(editionEntries.editionId, editionId)))
      }
    },

    listBattles: () => selectBattles(tx, editionId),
    async insertBattles(planned) {
      if (planned.length === 0) return []
      await tx.insert(battles).values(planned.map((battle) => ({ ...battle, editionId })))
      return selectBattles(tx, editionId)
    },
    async applyBattleChanges(changes) {
      const now = new Date()
      for (const change of changes) {
        await tx
          .update(battles)
          .set({ ...change.set, updatedAt: now })
          .where(and(eq(battles.id, change.battleId), eq(battles.editionId, editionId)))
      }
    },
    async deleteBattles() {
      await tx.delete(battles).where(eq(battles.editionId, editionId))
    },

    listRounds: () => selectRounds(tx, editionId),
    async insertRound(input) {
      const [row] = await tx.insert(battleRounds).values(input).returning()
      if (!row) throw new Error('round insert returned no rows')
      return toRound(row)
    },
    async deleteRound(id) {
      await tx.delete(battleRounds).where(eq(battleRounds.id, id))
    },

    listDraws: () => selectDraws(tx, editionId),
    async insertDraw({ reason, slots, createdBy, tickets }) {
      const [draw] = await tx
        .insert(crowdDraws)
        .values({ editionId, reason, slots, createdBy })
        .returning()
      if (!draw) throw new Error('crowd draw insert returned no rows')
      const ticketRows =
        tickets.length === 0
          ? []
          : await tx
              .insert(crowdDrawTickets)
              .values(tickets.map((t) => ({ ...t, editionId, drawId: draw.id })))
              .returning()
      return toDraw(draw, ticketRows)
    },
    async completeDraw(id, picked) {
      if (picked.length > 0) {
        await tx
          .update(crowdDrawTickets)
          .set({ picked: true })
          .where(
            and(eq(crowdDrawTickets.drawId, id), inArray(crowdDrawTickets.entryId, [...picked])),
          )
      }
      await tx
        .update(crowdDraws)
        .set({ completedAt: new Date() })
        .where(and(eq(crowdDraws.id, id), eq(crowdDraws.editionId, editionId)))
    },
    async deleteDraws() {
      await tx.delete(crowdDraws).where(eq(crowdDraws.editionId, editionId))
    },

    listWithdrawals: () => selectWithdrawals(tx, editionId),
    async insertWithdrawal(input) {
      const [row] = await tx
        .insert(withdrawals)
        .values({ ...input, editionId })
        .returning()
      if (!row) throw new Error('withdrawal insert returned no rows')
      return toWithdrawal(row)
    },
    async setWithdrawalReplacement(id, replacementEntryId) {
      await tx
        .update(withdrawals)
        .set({ replacementEntryId })
        .where(and(eq(withdrawals.id, id), eq(withdrawals.editionId, editionId)))
    },
  }
}

export const editionRepository: EditionRepository = {
  async findById(id) {
    const [row] = await db.select().from(editions).where(eq(editions.id, id))
    return row ? toEdition(row) : null
  },
  async findByEntryId(id) {
    const [row] = await db
      .select({ edition: editions })
      .from(editionEntries)
      .innerJoin(editions, eq(editions.id, editionEntries.editionId))
      .where(eq(editionEntries.id, id))
    return row ? toEdition(row.edition) : null
  },
  async findByBattleId(id) {
    const [row] = await db
      .select({ edition: editions })
      .from(battles)
      .innerJoin(editions, eq(editions.id, battles.editionId))
      .where(eq(battles.id, id))
    return row ? toEdition(row.edition) : null
  },
  async findByDrawId(id) {
    const [row] = await db
      .select({ edition: editions })
      .from(crowdDraws)
      .innerJoin(editions, eq(editions.id, crowdDraws.editionId))
      .where(eq(crowdDraws.id, id))
    return row ? toEdition(row.edition) : null
  },
  async create({ leagueId, eventDate }) {
    return db.transaction(async (tx) => {
      // Serialize numbering per league: concurrent creators queue on the
      // league row instead of both computing the same MAX + 1.
      await tx
        .select({ id: leagues.id })
        .from(leagues)
        .where(eq(leagues.id, leagueId))
        .for('update')
      const [next] = await tx
        .select({ number: sql<number>`COALESCE(MAX(${editions.number}), 0)::int + 1` })
        .from(editions)
        .where(eq(editions.leagueId, leagueId))
      const [row] = await tx
        .insert(editions)
        .values({ leagueId, eventDate, number: next?.number ?? 1 })
        .returning()
      if (!row) throw new Error('edition insert returned no rows')
      return toEdition(row)
    })
  },
  async withLock<R extends Result<unknown, unknown>>(
    id: EditionId,
    fn: (uow: EditionUnitOfWork) => Promise<R>,
  ): Promise<R | Result<never, NotFoundError>> {
    return transactionWithResult<R | Result<never, NotFoundError>>(async (tx) => {
      const [locked] = await tx.select().from(editions).where(eq(editions.id, id)).for('update')
      if (!locked) return err(new NotFoundError('edition not found'))
      return fn(makeUnitOfWork(tx, toEdition(locked)))
    })
  },
}
