import type { NotFoundError } from '@/shared/lib/errors/base'
import type {
  BattleId,
  BattleRoundId,
  CrowdDrawId,
  EditionId,
  EntryId,
  LeagueId,
  UserId,
  VulgoId,
  WithdrawalId,
} from '@/shared/lib/ids'
import type { Result } from '@/shared/lib/result'

import type { Battle, BattleChange, BattleRound, PlannedBattle } from '../domain/bracket'
import type { Edition, Entry, EntrySelection, EntryStatus } from '../domain/edition'
import type { CrowdDraw, CrowdDrawReason, Ticket } from '../domain/selection'
import type { Withdrawal, WithdrawalMethod } from '../domain/withdrawal'

// The shape of the edition repository and its unit of work. No port in
// front: one implementation (edition-repository.drizzle.ts), tested against
// the local database (ADR-0007).

export type EditionPatch = Partial<Pick<Edition, 'status' | 'bracketSize'>>

export type EntryStateUpdate = {
  id: EntryId
  status: EntryStatus
  selectedBy: EntrySelection | null
}

/**
 * Everything that changes an edition runs inside one transaction holding a
 * row lock on the edition. Two organizers' phones on the same night
 * (recording rounds, adding names, closing the list) are serialized, so the
 * pure domain rules always see a consistent snapshot.
 */
export type EditionUnitOfWork = {
  /** The edition as locked at the start of the transaction. */
  edition: Edition
  updateEdition(patch: EditionPatch): Promise<Edition>

  /** Ordered by arrival number. */
  listEntries(): Promise<Entry[]>
  /** Adds the vulgo at the end of the list. Throws if it is already on the list. */
  appendEntry(vulgoId: VulgoId): Promise<Entry>
  /** Removes an entry and closes the gap in the numbering. */
  removeEntry(id: EntryId): Promise<void>
  /** Moves an entry to arrival position `to`, shifting the ones in between. */
  moveEntry(id: EntryId, to: number): Promise<void>
  setEntryStates(updates: readonly EntryStateUpdate[]): Promise<void>

  listBattles(): Promise<Battle[]>
  insertBattles(planned: readonly PlannedBattle[]): Promise<Battle[]>
  applyBattleChanges(changes: readonly BattleChange[]): Promise<void>
  deleteBattles(): Promise<void>

  /** Every round of the edition. */
  listRounds(): Promise<BattleRound[]>
  insertRound(input: {
    battleId: BattleId
    roundNo: number
    votesA: number
    votesB: number
    recordedBy: UserId
  }): Promise<BattleRound>
  deleteRound(id: BattleRoundId): Promise<void>

  listDraws(): Promise<CrowdDraw[]>
  insertDraw(input: {
    reason: CrowdDrawReason
    slots: number
    createdBy: UserId
    tickets: readonly Ticket[]
  }): Promise<CrowdDraw>
  completeDraw(id: CrowdDrawId, picked: readonly EntryId[]): Promise<void>
  deleteDraws(): Promise<void>

  listWithdrawals(): Promise<Withdrawal[]>
  insertWithdrawal(input: {
    entryId: EntryId
    battleId: BattleId
    method: WithdrawalMethod
    replacementEntryId: EntryId | null
    crowdDrawId: CrowdDrawId | null
    recordedBy: UserId
  }): Promise<Withdrawal>
  setWithdrawalReplacement(id: WithdrawalId, replacementEntryId: EntryId): Promise<void>
}

export type EditionRepository = {
  findById(id: EditionId): Promise<Edition | null>
  findByEntryId(id: EntryId): Promise<Edition | null>
  findByBattleId(id: BattleId): Promise<Edition | null>
  findByDrawId(id: CrowdDrawId): Promise<Edition | null>
  /** Next number in the league (serialized per league). */
  create(input: { leagueId: LeagueId; eventDate: string }): Promise<Edition>
  /** `fn` returning `err` rolls back every write it made. */
  withLock<R extends Result<unknown, unknown>>(
    id: EditionId,
    fn: (uow: EditionUnitOfWork) => Promise<R>,
  ): Promise<R | Result<never, NotFoundError>>
}
