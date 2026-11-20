import { describe, expect, it } from 'vitest'

import { entryRefSchema } from './remove-entry.schema'

describe('entryRefSchema', () => {
  it('requires an entry id', () => {
    expect(entryRefSchema.safeParse({ entryId: 'x' }).success).toBe(false)
  })
})
