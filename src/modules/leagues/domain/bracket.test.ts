import { describe, expect, it } from 'vitest'

import {
  applyChanges,
  type Battle,
  type BattleRound,
  battleState,
  championOf,
  planBracket,
  recordRound,
  tally,
  undoLastRound,
} from './bracket'
import { at, entryId, orderedBracket, persist, round, seededIndex } from './test-fixtures'

const none = new Set<ReturnType<typeof entryId>>()

/** Records a round and returns the updated battles + rounds. */
function play(
  battles: Battle[],
  rounds: BattleRound[],
  battle: Battle,
  votesA: number,
  votesB: number,
): { battles: Battle[]; rounds: BattleRound[] } {
  const result = recordRound({
    battles,
    rounds,
    battleId: battle.id,
    votesA,
    votesB,
    unavailable: none,
  })
  if (!result.ok) throw result.error
  return {
    battles: applyChanges(battles, result.value.changes),
    rounds: [...rounds, round(battle.id, result.value.roundNo, votesA, votesB)],
  }
}

describe('planBracket', () => {
  it.each([8, 16])('pairs %i MCs at random and leaves later phases empty', (size) => {
    const selected = Array.from({ length: size }, (_, i) => entryId(i + 1))
    const result = planBracket(selected, seededIndex())
    if (!result.ok) throw result.error
    const battles = result.value
    expect(battles).toHaveLength(size - 1)
    const firstPhase = battles.filter((b) => b.phase === 1)
    expect(firstPhase.flatMap((b) => [b.entryAId, b.entryBId]).sort()).toEqual([...selected].sort())
    expect(battles.filter((b) => b.phase > 1).every((b) => !b.entryAId && !b.entryBId)).toBe(true)
  })

  it('refuses sizes other than 8 or 16', () => {
    const result = planBracket([1, 2, 3, 4].map(entryId), seededIndex())
    expect(!result.ok && result.error.code).toBe('CONFLICT')
  })

  it('draws different pairings with different randomness', () => {
    const selected = Array.from({ length: 8 }, (_, i) => entryId(i + 1))
    const pairings = new Set(
      [1, 2, 3, 4].map((seed) => {
        const r = planBracket(selected, seededIndex(seed))
        return r.ok ? r.value.map((b) => `${b.entryAId}-${b.entryBId}`).join() : ''
      }),
    )
    expect(pairings.size).toBeGreaterThan(1)
  })
})

describe('tally', () => {
  it('decides at two round wins', () => {
    expect(tally([{ votesA: 30, votesB: 20 }])).toEqual({ winsA: 1, winsB: 0, winner: null })
    expect(
      tally([
        { votesA: 30, votesB: 20 },
        { votesA: 25, votesB: 24 },
      ]).winner,
    ).toBe('A')
    expect(
      tally([
        { votesA: 30, votesB: 20 },
        { votesA: 10, votesB: 24 },
        { votesA: 11, votesB: 40 },
      ]).winner,
    ).toBe('B')
  })
})

describe('recordRound', () => {
  it('plays 2-0: decides the battle and advances the winner to slot A of the next', () => {
    let state = { battles: orderedBracket(), rounds: [] as BattleRound[] }
    const opener = at(state.battles, 1, 1)
    state = play(state.battles, state.rounds, opener, 40, 30)
    expect(at(state.battles, 1, 1).winnerEntryId).toBeNull()
    state = play(state.battles, state.rounds, opener, 41, 30)
    expect(at(state.battles, 1, 1).winnerEntryId).toBe(entryId(1))
    expect(at(state.battles, 2, 1).entryAId).toBe(entryId(1))
  })

  it('goes to a third round at 1-1, and position 2 feeds slot B', () => {
    let state = { battles: orderedBracket(), rounds: [] as BattleRound[] }
    const battle = at(state.battles, 1, 2)
    state = play(state.battles, state.rounds, battle, 40, 30)
    state = play(state.battles, state.rounds, battle, 20, 30)
    expect(at(state.battles, 1, 2).winnerEntryId).toBeNull()
    state = play(state.battles, state.rounds, battle, 10, 90)
    expect(at(state.battles, 1, 2).winnerEntryId).toBe(entryId(4))
    expect(at(state.battles, 2, 1).entryBId).toBe(entryId(4))
    expect(state.rounds.map((r) => r.roundNo)).toEqual([1, 2, 3])
  })

  it('crowns the champion through the final', () => {
    let state = { battles: orderedBracket(), rounds: [] as BattleRound[] }
    for (let phase = 1; phase <= 3; phase++) {
      for (const battle of state.battles.filter((b) => b.phase === phase)) {
        const current = state.battles.find((b) => b.id === battle.id)!
        state = play(state.battles, state.rounds, current, 10, 5)
        state = play(state.battles, state.rounds, current, 10, 5)
      }
    }
    expect(championOf(state.battles)).toBe(entryId(1))
  })

  it('rejects tied votes', () => {
    const battles = orderedBracket()
    const result = recordRound({
      battles,
      rounds: [],
      battleId: at(battles, 1, 1).id,
      votesA: 30,
      votesB: 30,
      unavailable: none,
    })
    expect(!result.ok && result.error.code).toBe('VALIDATION_ERROR')
  })

  it('rejects battles that are waiting, decided or awaiting a replacement', () => {
    let state = { battles: orderedBracket(), rounds: [] as BattleRound[] }
    const semi = at(state.battles, 2, 1)
    const waiting = recordRound({
      ...state,
      battleId: semi.id,
      votesA: 2,
      votesB: 1,
      unavailable: none,
    })
    expect(!waiting.ok && waiting.error.code).toBe('CONFLICT')

    const opener = at(state.battles, 1, 1)
    state = play(state.battles, state.rounds, opener, 2, 1)
    state = play(state.battles, state.rounds, opener, 2, 1)
    const decided = recordRound({
      ...state,
      battleId: opener.id,
      votesA: 2,
      votesB: 1,
      unavailable: none,
    })
    expect(!decided.ok && decided.error.code).toBe('CONFLICT')

    const replacement = recordRound({
      ...state,
      battleId: at(state.battles, 1, 2).id,
      votesA: 2,
      votesB: 1,
      unavailable: new Set([entryId(3)]),
    })
    expect(!replacement.ok && replacement.error.code).toBe('CONFLICT')
  })
})

describe('undoLastRound', () => {
  it('removes the last round of an undecided battle', () => {
    let state = { battles: orderedBracket(), rounds: [] as BattleRound[] }
    const opener = at(state.battles, 1, 1)
    state = play(state.battles, state.rounds, opener, 2, 1)
    const result = undoLastRound({ ...state, battleId: opener.id })
    if (!result.ok) throw result.error
    expect(result.value).toEqual({ roundId: state.rounds[0]!.id, changes: [] })
  })

  it('un-decides the battle and pulls the winner back from the next battle', () => {
    let state = { battles: orderedBracket(), rounds: [] as BattleRound[] }
    const opener = at(state.battles, 1, 1)
    state = play(state.battles, state.rounds, opener, 2, 1)
    state = play(state.battles, state.rounds, opener, 2, 1)
    const result = undoLastRound({ ...state, battleId: opener.id })
    if (!result.ok) throw result.error
    const battles = applyChanges(state.battles, result.value.changes)
    expect(at(battles, 1, 1).winnerEntryId).toBeNull()
    expect(at(battles, 2, 1).entryAId).toBeNull()
    expect(result.value.roundId).toBe(state.rounds[1]!.id)
  })

  it('refuses once the next battle has started', () => {
    let state = { battles: orderedBracket(), rounds: [] as BattleRound[] }
    for (const position of [1, 2]) {
      const battle = at(state.battles, 1, position)
      state = play(state.battles, state.rounds, battle, 2, 1)
      state = play(state.battles, state.rounds, battle, 2, 1)
    }
    state = play(state.battles, state.rounds, at(state.battles, 2, 1), 2, 1)
    const result = undoLastRound({ ...state, battleId: at(state.battles, 1, 1).id })
    expect(!result.ok && result.error.code).toBe('CONFLICT')
  })

  it('refuses when there is nothing to undo (including walkovers)', () => {
    const battles = applyChanges(orderedBracket(), [
      { battleId: at(orderedBracket(), 1, 1).id, set: { winnerEntryId: entryId(1) } },
    ])
    const result = undoLastRound({ battles, rounds: [], battleId: at(battles, 1, 1).id })
    expect(!result.ok && result.error.code).toBe('CONFLICT')
  })
})

describe('battleState', () => {
  it('reports where each battle stands', () => {
    const battles = orderedBracket()
    const opener = at(battles, 1, 1)
    expect(battleState(at(battles, 2, 1), [], none)).toBe('waiting')
    expect(battleState(opener, [], none)).toBe('ready')
    expect(battleState(opener, [round(opener.id, 1, 2, 1)], none)).toBe('live')
    expect(battleState(opener, [], new Set([entryId(2)]))).toBe('awaiting_replacement')
    expect(battleState({ ...opener, winnerEntryId: entryId(1) }, [], none)).toBe('decided')
  })
})

describe('persist fixture', () => {
  it('builds the expected 8-bracket', () => {
    expect(persist([]).length).toBe(0)
    expect(orderedBracket()).toHaveLength(7)
  })
})
