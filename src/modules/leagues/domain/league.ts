import type { LeagueId, UserId } from '@/shared/lib/ids'

/** A league: created by an admin, run by its organizers (all equals). */
export type League = {
  id: LeagueId
  name: string
  slug: string
  createdBy: UserId | null
  createdAt: Date
}

export type LeagueOrganizer = {
  leagueId: LeagueId
  userId: UserId
  name: string
  /** Null for a guest account, whose name is its nickname. */
  email: string | null
  addedAt: Date
}

/**
 * What the policy needs for a league-scoped action: the league (always
 * loaded from the DB) and whether the caller organizes it.
 */
export type LeagueAccess = { league: League; isOrganizer: boolean }

export const LEAGUE_SLUG_FALLBACK = 'league'
