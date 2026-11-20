import { describe, expect, it } from 'vitest'

import { moveEntrySchema } from './move-entry.schema'

const entryId = '00000000-0000-4000-8000-000000000000'

describe('moveEntrySchema', () => {
  it.each([0, -1, 1.5])('rejects position %s', (toNumber) => {
    expect(moveEntrySchema.safeParse({ entryId, toNumber }).success).toBe(false)
  })

  it('accepts a positive position', () => {
    expect(moveEntrySchema.safeParse({ entryId, toNumber: 3 }).success).toBe(true)
  })
})
