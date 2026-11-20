import type { BattleId, EntryId } from '@/shared/lib/ids'

import { type Battle, type BattleRound, opponentIn, phasesFor, roundsOf, slotOf } from './bracket'
import type { BracketSize, Edition, Entry } from './edition'

/**
 * What an edition meant for one vulgo (docs/mvp-spec.md, history phrases:
 * "not selected", "withdrew", "lost in the round of 16 / quarterfinals /
 * semifinal", "runner-up", "won the edition"). Codes, not sentences, so
 * any UI can translate them.
 */
export type Stage = 'final' | 'semifinal' | 'quarterfinal' | 'round_of_16'

const STAGES_FROM_FINAL: readonly Stage[] = ['final', 'semifinal', 'quarterfinal', 'round_of_16']

export function stageOf(phase: number, bracketSize: BracketSize): Stage {
  return STAGES_FROM_FINAL[phasesFor(bracketSize) - phase]!
}

export type EntryOutcome =
  | { result: 'registered' } // list not closed / selection pending
  | { result: 'not_selected' }
  | { result: 'withdrew' }
  | { result: 'in_contention' } // still in the bracket
  | { result: 'eliminated'; stage: Exclude<Stage, 'final'> }
  | { result: 'runner_up' }
  | { result: 'won' }

export function outcomeOf(
  entry: Pick<Entry, 'id' | 'status'>,
  edition: Pick<Edition, 'bracketSize'>,
  battles: readonly Battle[],
): EntryOutcome {
  if (entry.status === 'registered') return { result: 'registered' }
  if (entry.status === 'not_selected') return { result: 'not_selected' }
  if (entry.status === 'withdrew') return { result: 'withdrew' }

  // The furthest battle they stood in decides (a replacement who lost
  // earlier is judged by the battle they replaced into).
  const last = battles.filter((b) => slotOf(b, entry.id)).sort((a, b) => b.phase - a.phase)[0]
  if (!last || !last.winnerEntryId || !edition.bracketSize) return { result: 'in_contention' }

  const stage = stageOf(last.phase, edition.bracketSize)
  if (last.winnerEntryId === entry.id) {
    return stage === 'final' ? { result: 'won' } : { result: 'in_contention' }
  }
  return stage === 'final' ? { result: 'runner_up' } : { result: 'eliminated', stage }
}

export type HistoryBattle = {
  battleId: BattleId
  phase: number
  stage: Stage
  opponentEntryId: EntryId | null
  result: 'won' | 'lost' | 'pending'
  /** Decided without rounds (the opponent withdrew). */
  walkover: boolean
  /** From this MC's side: their votes first. */
  rounds: { roundNo: number; votesFor: number; votesAgainst: number }[]
}

/** Every battle `entryId` stood in, in bracket order, seen from their side. */
export function battlesFor(
  entryId: EntryId,
  bracketSize: BracketSize,
  battles: readonly Battle[],
  rounds: readonly BattleRound[],
): HistoryBattle[] {
  return battles
    .filter((b) => slotOf(b, entryId))
    .sort((a, b) => a.phase - b.phase)
    .map((battle) => {
      const isA = battle.entryAId === entryId
      const own = roundsOf(rounds, battle.id)
      return {
        battleId: battle.id,
        phase: battle.phase,
        stage: stageOf(battle.phase, bracketSize),
        opponentEntryId: opponentIn(battle, entryId),
        result: !battle.winnerEntryId
          ? 'pending'
          : battle.winnerEntryId === entryId
            ? 'won'
            : 'lost',
        walkover: Boolean(battle.winnerEntryId) && own.length === 0,
        rounds: own.map((r) => ({
          roundNo: r.roundNo,
          votesFor: isA ? r.votesA : r.votesB,
          votesAgainst: isA ? r.votesB : r.votesA,
        })),
      }
    })
}
