import { ForbiddenError } from '@/shared/lib/errors/base'
import { err, ok } from '@/shared/lib/result'

import { isAdmin, type Policy } from '@/modules/auth'

import type { LeagueAccess } from './league'

/**
 * docs/mvp-spec.md, "Roles":
 *
 * | action              | admin | organizer of the league |
 * | ------------------- | ----- | ----------------------- |
 * | create-league       |   ✓   |                         |
 * | manage-organizers   |   ✓   |                         |
 * | run-edition         |   ✓   |            ✓            |
 * | view-crowd-draw     |   ✓   |            ✓            |
 * | view-organizers     |   ✓   |            ✓            |
 * | review-vulgo-claim  |   ✓   | ✓ if the vulgo has an entry in one of their leagues |
 *
 * `run-edition` covers the whole battle night: names, selection, crowd
 * draws, bracket, rounds, withdrawals and corrections. Organizers may
 * battle and record their own results (the community audits live).
 * Reading leagues, editions and history is public and skips this policy.
 */
export type LeagueAction =
  | { type: 'create-league' }
  | { type: 'manage-organizers' }
  | { type: 'run-edition'; access: LeagueAccess }
  | { type: 'view-crowd-draw'; access: LeagueAccess }
  | { type: 'view-organizers'; access: LeagueAccess }
  | { type: 'review-vulgo-claim'; organizesLeagueWhereVulgoBattled: boolean }

export const leaguePolicy: Policy<LeagueAction> = (user, action) => {
  if (isAdmin(user)) return ok(undefined)

  switch (action.type) {
    case 'create-league':
    case 'manage-organizers':
      return err(new ForbiddenError(`only admins can ${action.type}`))
    case 'run-edition':
    case 'view-crowd-draw':
    case 'view-organizers':
      return action.access.isOrganizer
        ? ok(undefined)
        : err(new ForbiddenError(`cannot ${action.type} on league ${action.access.league.id}`))
    case 'review-vulgo-claim':
      return action.organizesLeagueWhereVulgoBattled
        ? ok(undefined)
        : err(new ForbiddenError('only organizers of a league where this vulgo battled can decide'))
  }
}
