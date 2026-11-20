import { describe, expect, it } from 'vitest'

import { battleRefSchema } from './undo-last-round.schema'

describe('battleRefSchema', () => {
  it('requires a battle id', () => {
    expect(battleRefSchema.safeParse({ battleId: 'nope' }).success).toBe(false)
  })
})
