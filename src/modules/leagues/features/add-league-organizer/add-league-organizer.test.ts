import { describe, expect, it } from 'vitest'

import { addLeagueOrganizerSchema } from './add-league-organizer.schema'

const leagueId = '00000000-0000-4000-8000-000000000000'

describe('addLeagueOrganizerSchema', () => {
  it('normalizes pasted emails before validating', () => {
    expect(
      addLeagueOrganizerSchema.parse({ leagueId, login: ' MC@Esquina.EXAMPLE ' }).login,
    ).toEqual({
      kind: 'email',
      email: 'mc@esquina.example',
    })
  })

  it('reads a login without @ as a guest nickname', () => {
    expect(addLeagueOrganizerSchema.parse({ leagueId, login: ' Mc_Wolf ' }).login).toEqual({
      kind: 'nickname',
      nickname: 'mc_wolf',
    })
  })

  it('rejects the guest domain as an email, so a guest is found only by nickname', () => {
    expect(
      addLeagueOrganizerSchema.safeParse({ leagueId, login: 'wolf@guest.invalid' }).success,
    ).toBe(false)
  })

  it('rejects logins that are neither an email nor a nickname', () => {
    expect(addLeagueOrganizerSchema.safeParse({ leagueId, login: 'no' }).success).toBe(false)
    expect(addLeagueOrganizerSchema.safeParse({ leagueId, login: 'not@valid' }).success).toBe(false)
  })
})
