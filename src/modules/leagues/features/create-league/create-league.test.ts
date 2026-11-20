import { describe, expect, it } from 'vitest'

import { createLeagueSchema } from './create-league.schema'

describe('createLeagueSchema', () => {
  it('accepts a name, trimmed', () => {
    expect(createLeagueSchema.parse({ name: '  Batalha da Aldeia ' }).name).toBe(
      'Batalha da Aldeia',
    )
  })

  it('rejects blank names and malformed slugs', () => {
    expect(createLeagueSchema.safeParse({ name: ' ' }).success).toBe(false)
    expect(createLeagueSchema.safeParse({ name: 'A', slug: 'Not Slug' }).success).toBe(false)
  })
})
