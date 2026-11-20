import { type ForbiddenError, NotFoundError } from '@/shared/lib/errors/base'
import type { BattleId, CrowdDrawId, EditionId, EntryId, LeagueId } from '@/shared/lib/ids'
import { err, ok, type Result } from '@/shared/lib/result'

import type { requireUser, User } from '@/modules/auth'

import { editionRepository } from './adapters/edition-repository.drizzle'
import { leagueRepository } from './adapters/league-repository.drizzle'
import type { Edition } from './domain/edition'
import type { LeagueAccess } from './domain/league'
import { leaguePolicy } from './domain/policy'

/**
 * The single path for league-scoped authorization: load the league from the
 * DB (never trust the client's idea of it), check whether the caller
 * organizes it, run `leaguePolicy`.
 */

type LeagueScopedAction = 'run-edition' | 'view-crowd-draw' | 'view-organizers'
type AuthzError = NotFoundError | ForbiddenError

export async function authorizeLeague(
  user: User,
  leagueId: LeagueId,
  type: LeagueScopedAction,
): Promise<Result<LeagueAccess, AuthzError>> {
  const league = await leagueRepository.findById(leagueId)
  if (!league) return err(new NotFoundError('league not found'))
  const access: LeagueAccess = {
    league,
    isOrganizer: await leagueRepository.isOrganizer(league.id, user.id),
  }
  const authz = leaguePolicy(user, { type, access })
  return authz.ok ? ok(access) : authz
}

/** How a handler points at an edition: directly or through one of its rows. */
export type EditionRef =
  | { editionId: EditionId }
  | { entryId: EntryId }
  | { battleId: BattleId }
  | { drawId: CrowdDrawId }

async function findEdition(ref: EditionRef): Promise<[Edition | null, string]> {
  if ('editionId' in ref) return [await editionRepository.findById(ref.editionId), 'edition']
  if ('entryId' in ref) return [await editionRepository.findByEntryId(ref.entryId), 'entry']
  if ('battleId' in ref) return [await editionRepository.findByBattleId(ref.battleId), 'battle']
  return [await editionRepository.findByDrawId(ref.drawId), 'crowd draw']
}

/**
 * Resolves the edition (so a client cannot claim a battle belongs to
 * another edition), then authorizes against its league.
 */
export async function authorizeEdition(
  user: User,
  ref: EditionRef,
  type: LeagueScopedAction,
): Promise<Result<{ edition: Edition; access: LeagueAccess }, AuthzError>> {
  const [edition, what] = await findEdition(ref)
  if (!edition) return err(new NotFoundError(`${what} not found`))
  const access = await authorizeLeague(user, edition.leagueId, type)
  return access.ok ? ok({ edition, access: access.value }) : access
}

/** The error side of `requireUser()`, for server functions that return Results. */
export type RequireUserError = Extract<
  Awaited<ReturnType<typeof requireUser>>,
  { ok: false }
>['error']
