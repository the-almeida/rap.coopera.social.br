import { describe, expect, it } from 'vitest'

import { createEditionSchema } from './create-edition.schema'

const leagueId = '00000000-0000-4000-8000-000000000000'

describe('createEditionSchema', () => {
  it('takes a calendar date', () => {
    expect(createEditionSchema.safeParse({ leagueId, eventDate: '2026-11-14' }).success).toBe(true)
  })

  it.each(['14/11/2026', '2026-11-14T20:00:00Z', '2026-02-30'])('rejects %s', (eventDate) => {
    expect(createEditionSchema.safeParse({ leagueId, eventDate }).success).toBe(false)
  })
})
