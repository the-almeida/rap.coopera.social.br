import { describe, expect, it } from 'vitest'

import { LeagueIdSchema, UserIdSchema } from '@/shared/lib/ids'

import type { User } from '@/modules/auth'

import type { League } from './league'
import { type LeagueAction, leaguePolicy } from './policy'

const user = (role: User['role'] = 'user'): User => ({
  id: UserIdSchema.parse('00000000-0000-4000-8000-000000000001'),
  email: 'mc@test',
  name: 'MC',
  guestNickname: null,
  role,
  pendingDeletion: null,
  createdAt: new Date(),
  updatedAt: new Date(),
})

const league: League = {
  id: LeagueIdSchema.parse('00000000-0000-4000-8000-0000000000aa'),
  name: 'Aldeia',
  slug: 'aldeia',
  createdBy: null,
  createdAt: new Date(),
}

const allowed = (action: LeagueAction, role: User['role'] = 'user') =>
  leaguePolicy(user(role), action).ok

describe('leaguePolicy', () => {
  it('reserves league creation and organizer management to admins', () => {
    expect(allowed({ type: 'create-league' })).toBe(false)
    expect(allowed({ type: 'manage-organizers' })).toBe(false)
    expect(allowed({ type: 'create-league' }, 'admin')).toBe(true)
    expect(allowed({ type: 'manage-organizers' }, 'admin')).toBe(true)
  })

  it.each(['run-edition', 'view-crowd-draw', 'view-organizers'] as const)(
    '%s: organizers of the league and admins only',
    (type) => {
      expect(allowed({ type, access: { league, isOrganizer: true } })).toBe(true)
      expect(allowed({ type, access: { league, isOrganizer: false } })).toBe(false)
      expect(allowed({ type, access: { league, isOrganizer: false } }, 'admin')).toBe(true)
    },
  )

  it('lets organizers review claims only for vulgos that battled in their leagues', () => {
    expect(allowed({ type: 'review-vulgo-claim', organizesLeagueWhereVulgoBattled: true })).toBe(
      true,
    )
    expect(allowed({ type: 'review-vulgo-claim', organizesLeagueWhereVulgoBattled: false })).toBe(
      false,
    )
    expect(
      allowed({ type: 'review-vulgo-claim', organizesLeagueWhereVulgoBattled: false }, 'admin'),
    ).toBe(true)
  })
})
