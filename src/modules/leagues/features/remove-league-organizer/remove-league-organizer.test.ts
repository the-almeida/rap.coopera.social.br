import { describe, expect, it } from 'vitest'

import { removeLeagueOrganizerSchema } from './remove-league-organizer.schema'

describe('removeLeagueOrganizerSchema', () => {
  it('requires uuids', () => {
    const id = '00000000-0000-4000-8000-000000000000'
    expect(removeLeagueOrganizerSchema.safeParse({ leagueId: id, userId: id }).success).toBe(true)
    expect(removeLeagueOrganizerSchema.safeParse({ leagueId: id, userId: 'x' }).success).toBe(false)
  })
})
