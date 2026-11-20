import { describe, expect, it } from 'vitest'

import { recordRoundSchema } from './record-round.schema'

const battleId = '00000000-0000-4000-8000-000000000000'

describe('recordRoundSchema', () => {
  it('accepts vote counts', () => {
    expect(recordRoundSchema.safeParse({ battleId, votesA: 57, votesB: 43 }).success).toBe(true)
  })

  it('rejects ties (the organizer casts the tiebreaker)', () => {
    expect(recordRoundSchema.safeParse({ battleId, votesA: 50, votesB: 50 }).success).toBe(false)
  })

  it.each([-1, 1.5])('rejects votes=%s', (votesA) => {
    expect(recordRoundSchema.safeParse({ battleId, votesA, votesB: 3 }).success).toBe(false)
  })
})
