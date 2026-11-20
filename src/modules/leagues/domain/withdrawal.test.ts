import { describe, expect, it } from 'vitest'

import { applyChanges, type Battle, type BattleRound } from './bracket'
import { at, entry, entryId, orderedBracket, round } from './test-fixtures'
import { planWithdrawal } from './withdrawal'

/** Entries 1..8 selected (paired 1v2, 3v4, ...), 9..11 not selected. */
const entries = [
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => entry(n)),
  ...[9, 10, 11].map((n) => entry(n, 'not_selected')),
]

function decide(battles: Battle[], phase: number, position: number, winner: number): Battle[] {
  const battle = at(battles, phase, position)
  const nextPosition = Math.ceil(position / 2)
  const slot = position % 2 === 1 ? 'entryAId' : 'entryBId'
  return applyChanges(battles, [
    { battleId: battle.id, set: { winnerEntryId: entryId(winner) } },
    ...(phase < 3
      ? [{ battleId: at(battles, phase + 1, nextPosition).id, set: { [slot]: entryId(winner) } }]
      : []),
  ])
}

describe('planWithdrawal', () => {
  it('runs a crowd draw before the first battle', () => {
    const result = planWithdrawal({
      entry: entry(3),
      entries,
      battles: orderedBracket(),
      rounds: [],
    })
    expect(result).toEqual({
      ok: true,
      value: {
        method: 'crowd_draw',
        battleId: at(orderedBracket(), 1, 2).id,
        pool: [9, 10, 11].map(entryId),
      },
    })
  })

  it('gives a walkover before the first battle when nobody is left to draw', () => {
    const everyoneSelected = entries.filter((e) => e.status === 'selected')
    const battles = orderedBracket()
    const result = planWithdrawal({
      entry: entry(3),
      entries: everyoneSelected,
      battles,
      rounds: [],
    })
    if (!result.ok) throw result.error
    expect(result.value.method).toBe('walkover')
    const after = applyChanges(
      battles,
      result.value.method === 'walkover' ? result.value.changes : [],
    )
    expect(at(after, 1, 2).winnerEntryId).toBe(entryId(4))
    expect(at(after, 2, 1).entryBId).toBe(entryId(4))
  })

  it('gives a walkover mid-battle, even with MCs left to draw', () => {
    const battles = orderedBracket()
    const rounds: BattleRound[] = [round(at(battles, 1, 1).id, 1, 10, 5)]
    const result = planWithdrawal({ entry: entry(1), entries, battles, rounds })
    if (!result.ok) throw result.error
    expect(result.value.method).toBe('walkover')
  })

  it('replaces a winner who leaves with the MC they beat most recently', () => {
    // 1 beat 2 in the quarters, 3 beat 4; 1 leaves before the semi.
    let battles = decide(orderedBracket(), 1, 1, 1)
    battles = decide(battles, 1, 2, 3)
    const result = planWithdrawal({ entry: entry(1), entries, battles, rounds: [] })
    if (!result.ok) throw result.error
    expect(result.value).toMatchObject({
      method: 'previous_opponent',
      battleId: at(battles, 2, 1).id,
      replacementEntryId: entryId(2),
    })
    const after = applyChanges(
      battles,
      result.value.method === 'previous_opponent' ? result.value.changes : [],
    )
    expect(at(after, 2, 1)).toMatchObject({ entryAId: entryId(2), entryBId: entryId(3) })
  })

  it('uses the most recent win when the leaver won several battles', () => {
    // 1 beat 2 (QF) and 3 (SF); leaves before the final.
    let battles = decide(orderedBracket(), 1, 1, 1)
    battles = decide(battles, 1, 2, 3)
    battles = decide(battles, 2, 1, 1)
    const result = planWithdrawal({ entry: entry(1), entries, battles, rounds: [] })
    expect(result.ok && result.value).toMatchObject({ replacementEntryId: entryId(3) })
  })

  it('refuses MCs with no battle left or not selected', () => {
    const battles = decide(orderedBracket(), 1, 1, 1)
    expect(planWithdrawal({ entry: entry(2), entries, battles, rounds: [] }).ok).toBe(false)
    expect(
      planWithdrawal({ entry: entry(9, 'not_selected'), entries, battles, rounds: [] }).ok,
    ).toBe(false)
  })
})
