import { ConflictError } from '@/shared/lib/errors/base'
import type {
  BattleId,
  CrowdDrawId,
  EditionId,
  EntryId,
  UserId,
  WithdrawalId,
} from '@/shared/lib/ids'
import { err, ok, type Result } from '@/shared/lib/result'

import {
  type Battle,
  type BattleChange,
  type BattleRound,
  decideChanges,
  opponentIn,
  roundsOf,
  slotOf,
} from './bracket'
import type { Entry } from './edition'

/**
 * A selected MC leaving (docs/mvp-spec.md, "Withdrawals"), decided in this
 * order:
 *
 * 1. Mid-battle (a round of their current battle is recorded): walkover,
 *    the opponent advances.
 * 2. Before their first battle: a new crowd draw among the MCs still not
 *    selected; walkover if nobody is left.
 * 3. After winning at least one battle: the MC they beat most recently
 *    takes their place.
 * 4. Otherwise (only possible for a replacement who has not battled in
 *    their new slot yet): walkover once the opponent is known.
 */
export type WithdrawalPlan =
  | { method: 'walkover'; battleId: BattleId; changes: BattleChange[] }
  | {
      method: 'previous_opponent'
      battleId: BattleId
      replacementEntryId: EntryId
      changes: BattleChange[]
    }
  | { method: 'crowd_draw'; battleId: BattleId; pool: EntryId[] }

export function planWithdrawal(input: {
  entry: Entry
  entries: readonly Entry[]
  battles: readonly Battle[]
  rounds: readonly BattleRound[]
}): Result<WithdrawalPlan, ConflictError> {
  const { entry, battles } = input
  if (entry.status !== 'selected') {
    return err(new ConflictError('only selected MCs still in the bracket can withdraw'))
  }
  const current = battles.find((b) => slotOf(b, entry.id) && b.winnerEntryId === null)
  if (!current) return err(new ConflictError('this MC has no battle left'))
  const opponent = opponentIn(current, entry.id)

  const walkover = (): Result<WithdrawalPlan, ConflictError> =>
    opponent
      ? ok({
          method: 'walkover',
          battleId: current.id,
          changes: decideChanges(battles, current, opponent),
        })
      : err(new ConflictError('wait until the opponent is known, then record the withdrawal'))

  if (roundsOf(input.rounds, current.id).length > 0) return walkover()

  if (current.phase === 1) {
    const pool = input.entries.filter((e) => e.status === 'not_selected').map((e) => e.id)
    return pool.length > 0 ? ok({ method: 'crowd_draw', battleId: current.id, pool }) : walkover()
  }

  const lastWin = battles
    .filter((b) => b.winnerEntryId === entry.id)
    .sort((a, b) => b.phase - a.phase)[0]
  const beaten = lastWin ? opponentIn(lastWin, entry.id) : null
  if (beaten) {
    return ok({
      method: 'previous_opponent',
      battleId: current.id,
      replacementEntryId: beaten,
      changes: [replaceInBattle(current, entry.id, beaten)],
    })
  }
  return walkover()
}

/** Puts `replacement` in the slot `leaver` held. */
export function replaceInBattle(
  battle: Battle,
  leaver: EntryId,
  replacement: EntryId,
): BattleChange {
  const slot = slotOf(battle, leaver)
  if (!slot) throw new Error(`entry ${leaver} is not in battle ${battle.id}`)
  return { battleId: battle.id, set: { [slot]: replacement } }
}

export type WithdrawalMethod = WithdrawalPlan['method']

/** A recorded withdrawal. */
export type Withdrawal = {
  id: WithdrawalId
  editionId: EditionId
  entryId: EntryId
  battleId: BattleId
  /** Set immediately (previous opponent) or when the crowd picks (crowd draw). */
  replacementEntryId: EntryId | null
  method: WithdrawalMethod
  crowdDrawId: CrowdDrawId | null
  recordedBy: UserId | null
  recordedAt: Date
}
