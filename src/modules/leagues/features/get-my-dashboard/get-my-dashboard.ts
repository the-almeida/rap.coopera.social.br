import { ok, type Result } from '@/shared/lib/result'

import { isAdmin, requireUser } from '@/modules/auth'
import { getMyMcIdentity, type MyMcIdentity } from '@/modules/mcs'

import { leagueRepository } from '../../adapters/league-repository.drizzle'
import type { RequireUserError } from '../../authorize'
import type { League } from '../../domain/league'
import { getHistoryForVulgos, type HistoryEntry } from '../vulgo-history/vulgo-history'

export type MyDashboard = MyMcIdentity & {
  history: HistoryEntry[]
  isAdmin: boolean
  /** Leagues the MC organizes. */
  organizes: League[]
}

/**
 * The signed-in MC's dashboard: profile (created on first visit), vulgos,
 * claims, battle history across every league, and the leagues they organize.
 * Server-only function for Server Components.
 */
export async function getMyDashboard(): Promise<Result<MyDashboard, RequireUserError>> {
  const userResult = await requireUser()
  if (!userResult.ok) return userResult
  const user = userResult.value

  const identity = await getMyMcIdentity(user)
  const [history, organizes] = await Promise.all([
    getHistoryForVulgos(identity.vulgos.map((v) => v.id)),
    leagueRepository.listForOrganizer(user.id),
  ])
  return ok({ ...identity, history, isAdmin: isAdmin(user), organizes })
}
