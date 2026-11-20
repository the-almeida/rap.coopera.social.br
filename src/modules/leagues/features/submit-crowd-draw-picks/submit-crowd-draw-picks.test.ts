import { describe, expect, it } from 'vitest'

import { submitCrowdDrawPicksSchema } from './submit-crowd-draw-picks.schema'

const drawId = '00000000-0000-4000-8000-000000000000'

describe('submitCrowdDrawPicksSchema', () => {
  it('accepts 1 to 4 positive numbers', () => {
    expect(submitCrowdDrawPicksSchema.safeParse({ drawId, numbers: [3, 7] }).success).toBe(true)
  })

  it.each([[[]], [[0]], [[1, 2, 3, 4, 5]], [[1.5]]])('rejects %o', (numbers) => {
    expect(submitCrowdDrawPicksSchema.safeParse({ drawId, numbers }).success).toBe(false)
  })
})
