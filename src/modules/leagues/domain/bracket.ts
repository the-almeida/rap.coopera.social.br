import { ConflictError, NotFoundError, ValidationError } from '@/shared/lib/errors/base'
import type { BattleId, BattleRoundId, EditionId, EntryId, UserId } from '@/shared/lib/ids'
import { err, ok, type Result } from '@/shared/lib/result'

import type { BracketSize } from './edition'
import { type RandomIndex, shuffle } from './selection'

/**
 * Single-elimination bracket of 8 or 16 (docs/mvp-spec.md, steps 3–4).
 * Pure functions: adapters load the bracket inside a transaction that locks
 * the edition, call these, and persist the returned changes.
 *
 * Layout: `log2(size)` phases; all `size - 1` battles exist from the start.
 * The winner of (phase p, position n) moves to (p + 1, ceil(n / 2)): slot A
 * when n is odd, B when even. The last phase has one battle, the final.
 *
 * A battle is two rounds plus a third at 1-1; the first MC to win two
 * rounds wins. Each round has the crowd's vote counts; ties never happen
 * (the organizer casts the tiebreaker vote).
 */

export type Slot = 'entryAId' | 'entryBId'

export type Battle = {
  id: BattleId
  editionId: EditionId
  phase: number
  position: number
  entryAId: EntryId | null
  entryBId: EntryId | null
  winnerEntryId: EntryId | null
}

export type BattleRound = {
  id: BattleRoundId
  battleId: BattleId
  roundNo: number
  votesA: number
  votesB: number
  recordedBy: UserId | null
  recordedAt: Date
}

export type PlannedBattle = Pick<
  Battle,
  'phase' | 'position' | 'entryAId' | 'entryBId' | 'winnerEntryId'
>

/** A partial update of one battle. */
export type BattleChange = {
  battleId: BattleId
  set: Partial<Pick<Battle, Slot | 'winnerEntryId'>>
}

export const ROUNDS_TO_WIN = 2
export const MAX_ROUNDS = 3

export function phasesFor(size: BracketSize): number {
  return size === 8 ? 3 : 4
}

/** Random pairing of the selected MCs; every later battle starts empty. */
export function planBracket(
  selected: readonly EntryId[],
  randomIndex: RandomIndex,
): Result<PlannedBattle[], ConflictError> {
  if (selected.length !== 8 && selected.length !== 16) {
    return err(new ConflictError(`a bracket needs 8 or 16 MCs, got ${selected.length}`))
  }
  const order = shuffle(selected, randomIndex)
  const size = selected.length as BracketSize
  const battles: PlannedBattle[] = []
  for (let phase = 1; phase <= phasesFor(size); phase++) {
    const count = size / 2 ** phase
    for (let position = 1; position <= count; position++) {
      const first = phase === 1
      battles.push({
        phase,
        position,
        entryAId: first ? order[(position - 1) * 2]! : null,
        entryBId: first ? order[(position - 1) * 2 + 1]! : null,
        winnerEntryId: null,
      })
    }
  }
  return ok(battles)
}

export function slotOf(battle: Battle, entryId: EntryId): Slot | null {
  if (battle.entryAId === entryId) return 'entryAId'
  if (battle.entryBId === entryId) return 'entryBId'
  return null
}

export function opponentIn(battle: Battle, entryId: EntryId): EntryId | null {
  return battle.entryAId === entryId ? battle.entryBId : battle.entryAId
}

/** The battle the winner of `battle` moves to, and which slot; null for the final. */
export function nextOf(
  battles: readonly Battle[],
  battle: Pick<Battle, 'phase' | 'position'>,
): { battle: Battle; slot: Slot } | null {
  const next = battles.find(
    (b) => b.phase === battle.phase + 1 && b.position === Math.ceil(battle.position / 2),
  )
  return next ? { battle: next, slot: battle.position % 2 === 1 ? 'entryAId' : 'entryBId' } : null
}

export function roundsOf(rounds: readonly BattleRound[], battleId: BattleId): BattleRound[] {
  return rounds.filter((r) => r.battleId === battleId).sort((a, b) => a.roundNo - b.roundNo)
}

export function tally(rounds: readonly Pick<BattleRound, 'votesA' | 'votesB'>[]): {
  winsA: number
  winsB: number
  winner: 'A' | 'B' | null
} {
  const winsA = rounds.filter((r) => r.votesA > r.votesB).length
  const winsB = rounds.length - winsA
  const winner = winsA >= ROUNDS_TO_WIN ? 'A' : winsB >= ROUNDS_TO_WIN ? 'B' : null
  return { winsA, winsB, winner }
}

/** Decides `battle` for `winner` and moves them into the next battle. */
export function decideChanges(
  battles: readonly Battle[],
  battle: Battle,
  winner: EntryId,
): BattleChange[] {
  const changes: BattleChange[] = [{ battleId: battle.id, set: { winnerEntryId: winner } }]
  const next = nextOf(battles, battle)
  if (next) changes.push({ battleId: next.battle.id, set: { [next.slot]: winner } })
  return changes
}

export function championOf(battles: readonly Battle[]): EntryId | null {
  if (battles.length === 0) return null
  const lastPhase = Math.max(...battles.map((b) => b.phase))
  return battles.find((b) => b.phase === lastPhase)?.winnerEntryId ?? null
}

export type RecordRoundInput = {
  battles: readonly Battle[]
  rounds: readonly BattleRound[]
  battleId: BattleId
  votesA: number
  votesB: number
  /** Entries that cannot battle right now (withdrew, replacement pending). */
  unavailable: ReadonlySet<EntryId>
}

/**
 * Records the next round of a battle. When a side reaches two round wins
 * the battle is decided and the winner advances.
 */
export function recordRound(
  input: RecordRoundInput,
): Result<
  { roundNo: number; changes: BattleChange[] },
  NotFoundError | ConflictError | ValidationError
> {
  const battle = input.battles.find((b) => b.id === input.battleId)
  if (!battle) return err(new NotFoundError('battle not found'))
  if (battle.winnerEntryId) return err(new ConflictError('this battle is already decided'))
  if (!battle.entryAId || !battle.entryBId) {
    return err(new ConflictError('this battle is still waiting for both MCs'))
  }
  if (input.unavailable.has(battle.entryAId) || input.unavailable.has(battle.entryBId)) {
    return err(new ConflictError('this battle is waiting for a replacement MC'))
  }
  if (input.votesA === input.votesB) {
    return err(
      new ValidationError(
        {
          formErrors: [],
          fieldErrors: { votes: ['a round cannot tie; include the tiebreaker vote'] },
        },
        'Tied round',
      ),
    )
  }

  const previous = roundsOf(input.rounds, battle.id)
  const { winner } = tally([...previous, { votesA: input.votesA, votesB: input.votesB }])
  const changes = winner
    ? decideChanges(input.battles, battle, winner === 'A' ? battle.entryAId : battle.entryBId)
    : []
  return ok({ roundNo: previous.length + 1, changes })
}

/**
 * Removes the last round of a battle (a mistyped vote count). If that
 * round had decided the battle, the winner is pulled back out of the next
 * battle, which is only allowed while that battle has not started.
 */
export function undoLastRound(input: {
  battles: readonly Battle[]
  rounds: readonly BattleRound[]
  battleId: BattleId
}): Result<{ roundId: BattleRoundId; changes: BattleChange[] }, NotFoundError | ConflictError> {
  const battle = input.battles.find((b) => b.id === input.battleId)
  if (!battle) return err(new NotFoundError('battle not found'))
  const rounds = roundsOf(input.rounds, battle.id)
  const last = rounds.at(-1)
  if (!last) return err(new ConflictError('this battle has no round to undo'))

  const changes: BattleChange[] = []
  if (battle.winnerEntryId) {
    const next = nextOf(input.battles, battle)
    if (next) {
      if (next.battle.winnerEntryId || roundsOf(input.rounds, next.battle.id).length > 0) {
        return err(new ConflictError('the next battle already started; undo its rounds first'))
      }
      if (next.battle[next.slot] !== battle.winnerEntryId) {
        return err(new ConflictError('the bracket changed after this result (withdrawal)'))
      }
      changes.push({ battleId: next.battle.id, set: { [next.slot]: null } })
    }
    changes.unshift({ battleId: battle.id, set: { winnerEntryId: null } })
  }
  return ok({ roundId: last.id, changes })
}

/** Applies `changes` over `battles` (returns new objects). */
export function applyChanges(
  battles: readonly Battle[],
  changes: readonly BattleChange[],
): Battle[] {
  return battles.map((battle) =>
    changes
      .filter((c) => c.battleId === battle.id)
      .reduce<Battle>((acc, change) => ({ ...acc, ...change.set }), battle),
  )
}

export type BattleState =
  | 'waiting' // an opponent is still unknown
  | 'awaiting_replacement' // an MC withdrew, the crowd draw is pending
  | 'ready' // both MCs known, no round yet
  | 'live' // at least one round recorded
  | 'decided'

export function battleState(
  battle: Battle,
  rounds: readonly BattleRound[],
  unavailable: ReadonlySet<EntryId>,
): BattleState {
  if (battle.winnerEntryId) return 'decided'
  if (!battle.entryAId || !battle.entryBId) return 'waiting'
  if (unavailable.has(battle.entryAId) || unavailable.has(battle.entryBId)) {
    return 'awaiting_replacement'
  }
  return roundsOf(rounds, battle.id).length > 0 ? 'live' : 'ready'
}
