import { describe, expect, it } from 'vitest'

import { addEntrySchema } from './add-entry.schema'

const id = '00000000-0000-4000-8000-000000000000'

describe('addEntrySchema', () => {
  it('accepts a picked vulgo or a typed name', () => {
    expect(addEntrySchema.safeParse({ editionId: id, vulgoId: id }).success).toBe(true)
    expect(addEntrySchema.safeParse({ editionId: id, vulgoName: 'Zé Ramalho' }).success).toBe(true)
  })

  it('rejects blank names', () => {
    expect(addEntrySchema.safeParse({ editionId: id, vulgoName: '   ' }).success).toBe(false)
  })
})
