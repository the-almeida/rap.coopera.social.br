import type { ForbiddenError, NotFoundError } from '@/shared/lib/errors/base'
import type { EditionId, EntryId } from '@/shared/lib/ids'
import { ok, type Result } from '@/shared/lib/result'

import { requireUser } from '@/modules/auth'
import { getVulgoSummaries, type VulgoSummary } from '@/modules/mcs'

import { leagueReadModel } from '../../adapters/league-read-model.drizzle'
import { authorizeEdition, type RequireUserError } from '../../authorize'
import type { CrowdDraw } from '../../domain/selection'

export type CrowdDrawView = Omit<CrowdDraw, 'tickets'> & {
  tickets: { number: number; entryId: EntryId; vulgo: VulgoSummary | null; picked: boolean }[]
}

/**
 * The edition's crowd draws with their number → MC lists. Organizers and
 * admins only (docs/mvp-spec.md): the crowd only hears the number range.
 * Server-only function for the organizer's live screen.
 */
export async function getCrowdDraws(
  editionId: EditionId,
): Promise<Result<CrowdDrawView[], RequireUserError | NotFoundError | ForbiddenError>> {
  const userResult = await requireUser()
  if (!userResult.ok) return userResult

  const authz = await authorizeEdition(userResult.value, { editionId }, 'view-crowd-draw')
  if (!authz.ok) return authz

  const { draws, entries } = await leagueReadModel.getEditionSnapshot(editionId)
  const vulgoByEntry = new Map(entries.map((e) => [e.id, e.vulgoId]))
  const summaries = new Map(
    (await getVulgoSummaries(entries.map((e) => e.vulgoId))).map((v) => [v.id, v]),
  )
  return ok(
    draws.map((draw) => ({
      ...draw,
      tickets: draw.tickets.map((t) => {
        const vulgoId = vulgoByEntry.get(t.entryId)
        return { ...t, vulgo: vulgoId ? (summaries.get(vulgoId) ?? null) : null }
      }),
    })),
  )
}
