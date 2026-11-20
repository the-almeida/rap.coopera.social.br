import { describe, expect, it } from 'vitest'

import { applyChanges } from './bracket'
import { battlesFor, outcomeOf, stageOf } from './history'
import { at, edition, entry, entryId, orderedBracket, round } from './test-fixtures'

describe('stageOf', () => {
  it('names phases counting back from the final', () => {
    expect([1, 2, 3].map((p) => stageOf(p, 8))).toEqual(['quarterfinal', 'semifinal', 'final'])
    expect([1, 2, 3, 4].map((p) => stageOf(p, 16))).toEqual([
      'round_of_16',
      'quarterfinal',
      'semifinal',
      'final',
    ])
  })
})

describe('outcomeOf', () => {
  const ed = edition()
  const bracket = orderedBracket()
  // 1 beats 2 (QF), 1 beats 3 (SF), 5 beats 1 in the final.
  const played = applyChanges(bracket, [
    { battleId: at(bracket, 1, 1).id, set: { winnerEntryId: entryId(1) } },
    {
      battleId: at(bracket, 2, 1).id,
      set: { entryAId: entryId(1), entryBId: entryId(3), winnerEntryId: entryId(1) },
    },
    {
      battleId: at(bracket, 3, 1).id,
      set: { entryAId: entryId(1), entryBId: entryId(5), winnerEntryId: entryId(5) },
    },
  ])

  it.each([
    ['registered', entry(9, 'registered'), { result: 'registered' }],
    ['not selected', entry(9, 'not_selected'), { result: 'not_selected' }],
    ['withdrew', entry(7, 'withdrew'), { result: 'withdrew' }],
    ['lost in the quarterfinal', entry(2), { result: 'eliminated', stage: 'quarterfinal' }],
    ['lost in the semifinal', entry(3), { result: 'eliminated', stage: 'semifinal' }],
    ['runner-up', entry(1), { result: 'runner_up' }],
    ['champion', entry(5), { result: 'won' }],
    ['still battling', entry(7), { result: 'in_contention' }],
  ] as const)('%s', (_label, e, expected) => {
    expect(outcomeOf(e, ed, played)).toEqual(expected)
  })

  it('judges a replacement by the battle they replaced into', () => {
    // 2 lost to 1 in the QF, then replaced 1 in the semi and lost to 3.
    const replaced = applyChanges(played, [
      { battleId: at(played, 2, 1).id, set: { entryAId: entryId(2), winnerEntryId: entryId(3) } },
    ])
    expect(outcomeOf(entry(2), ed, replaced)).toEqual({ result: 'eliminated', stage: 'semifinal' })
  })
})

describe('battlesFor', () => {
  const bracket = orderedBracket()
  const played = applyChanges(bracket, [
    { battleId: at(bracket, 1, 2).id, set: { winnerEntryId: entryId(4) } },
    { battleId: at(bracket, 1, 1).id, set: { winnerEntryId: entryId(1) } },
    { battleId: at(bracket, 2, 1).id, set: { entryAId: entryId(1), entryBId: entryId(4) } },
  ])
  // 1v2 went to three rounds (2-1 for entry 1); 3v4 was a walkover.
  const rounds = [
    round(at(bracket, 1, 1).id, 1, 30, 20),
    round(at(bracket, 1, 1).id, 2, 10, 40),
    round(at(bracket, 1, 1).id, 3, 33, 32),
  ]

  it('lists battles from the MC side, with votes and results', () => {
    expect(battlesFor(entryId(2), 8, played, rounds)).toEqual([
      {
        battleId: at(bracket, 1, 1).id,
        phase: 1,
        stage: 'quarterfinal',
        opponentEntryId: entryId(1),
        result: 'lost',
        walkover: false,
        rounds: [
          { roundNo: 1, votesFor: 20, votesAgainst: 30 },
          { roundNo: 2, votesFor: 40, votesAgainst: 10 },
          { roundNo: 3, votesFor: 32, votesAgainst: 33 },
        ],
      },
    ])
  })

  it('flags walkovers and pending battles', () => {
    const history = battlesFor(entryId(4), 8, played, rounds)
    expect(history.map((b) => [b.stage, b.result, b.walkover])).toEqual([
      ['quarterfinal', 'won', true],
      ['semifinal', 'pending', false],
    ])
  })
})
