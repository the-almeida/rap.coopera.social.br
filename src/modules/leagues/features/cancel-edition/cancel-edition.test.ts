import { describe, expect, it } from 'vitest'

import { editionRefSchema } from './cancel-edition.schema'

describe('editionRefSchema', () => {
  it('requires an edition id', () => {
    expect(editionRefSchema.safeParse({}).success).toBe(false)
    expect(
      editionRefSchema.safeParse({ editionId: '00000000-0000-4000-8000-000000000000' }).success,
    ).toBe(true)
  })
})
