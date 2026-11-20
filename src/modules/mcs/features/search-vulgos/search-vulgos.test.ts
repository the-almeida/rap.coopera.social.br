import { describe, expect, it } from 'vitest'

import { searchVulgosSchema } from './search-vulgos.schema'

describe('searchVulgosSchema', () => {
  it('trims, defaults the limit and rejects blank queries', () => {
    expect(searchVulgosSchema.parse({ query: ' ze ' })).toEqual({ query: 'ze', limit: 10 })
    expect(searchVulgosSchema.safeParse({ query: '  ' }).success).toBe(false)
  })

  it('caps the limit', () => {
    expect(searchVulgosSchema.safeParse({ query: 'ze', limit: 51 }).success).toBe(false)
  })
})
