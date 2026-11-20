import { describe, expect, it } from 'vitest'

import { planSelection, resolvePicks, shuffle, splitByArrival, numberTickets } from './selection'
import { entry, entryId, seededIndex } from './test-fixtures'

describe('planSelection (spec table)', () => {
  it.each([
    [8, { bracketSize: 8, byArrival: 8, drawSlots: 0 }],
    [9, { bracketSize: 8, byArrival: 6, drawSlots: 2 }],
    [15, { bracketSize: 8, byArrival: 6, drawSlots: 2 }],
    [16, { bracketSize: 16, byArrival: 16, drawSlots: 0 }],
    [17, { bracketSize: 16, byArrival: 12, drawSlots: 4 }],
    [60, { bracketSize: 16, byArrival: 12, drawSlots: 4 }],
  ])('%i names -> %o', (count, plan) => {
    expect(planSelection(count)).toEqual({ ok: true, value: plan })
  })

  it('refuses fewer than 8 names', () => {
    const result = planSelection(7)
    expect(!result.ok && result.error.code).toBe('CONFLICT')
  })
})

describe('splitByArrival', () => {
  it('guarantees the earliest arrivals regardless of list order', () => {
    const entries = [
      entry(3),
      entry(1),
      entry(10),
      entry(2),
      entry(9),
      entry(4),
      entry(5),
      entry(6),
      entry(7),
      entry(8),
    ]
    const { byArrival, pool } = splitByArrival(entries, {
      bracketSize: 8,
      byArrival: 6,
      drawSlots: 2,
    })
    expect(byArrival).toEqual([1, 2, 3, 4, 5, 6].map(entryId))
    expect(pool).toEqual([7, 8, 9, 10].map(entryId))
  })
})

describe('crowd draw numbers', () => {
  const pool = [7, 8, 9, 10, 11].map(entryId)

  it('numbers the pool 1..X, each entry once', () => {
    const tickets = numberTickets(pool, seededIndex())
    expect(tickets.map((t) => t.number)).toEqual([1, 2, 3, 4, 5])
    expect(tickets.map((t) => t.entryId).sort()).toEqual([...pool].sort())
  })

  it('does not follow arrival order (different draws differ)', () => {
    const orders = new Set(
      [1, 2, 3, 4, 5].map((seed) =>
        numberTickets(pool, seededIndex(seed))
          .map((t) => t.entryId)
          .join(),
      ),
    )
    expect(orders.size).toBeGreaterThan(1)
  })

  it('resolves the numbers the crowd called out', () => {
    const tickets = numberTickets(pool, seededIndex())
    const result = resolvePicks(tickets, [5, 2], 2)
    expect(result).toEqual({
      ok: true,
      value: [tickets[4]!.entryId, tickets[1]!.entryId],
    })
  })

  it.each([
    ['too few numbers', [1]],
    ['too many numbers', [1, 2, 3]],
    ['a repeated number', [2, 2]],
    ['a number out of range', [1, 6]],
  ])('rejects %s', (_label, numbers) => {
    const result = resolvePicks(numberTickets(pool, seededIndex()), numbers, 2)
    expect(!result.ok && result.error.code).toBe('VALIDATION_ERROR')
  })
})

describe('shuffle', () => {
  it('keeps every item and does not mutate the input', () => {
    const items = [1, 2, 3, 4, 5, 6]
    const shuffled = shuffle(items, seededIndex())
    expect([...shuffled].sort()).toEqual(items)
    expect(items).toEqual([1, 2, 3, 4, 5, 6])
  })
})
