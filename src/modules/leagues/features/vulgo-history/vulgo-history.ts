import type { EntryId, VulgoId } from '@/shared/lib/ids'

import { getVulgoSummaries, type VulgoSummary } from '@/modules/mcs'

import { leagueReadModel } from '../../adapters/league-read-model.drizzle'
import type { Edition } from '../../domain/edition'
import { battlesFor, type EntryOutcome, type HistoryBattle, outcomeOf } from '../../domain/history'
import type { League } from '../../domain/league'

export type HistoryEntry = {
  league: Pick<League, 'id' | 'name' | 'slug'>
  edition: Pick<Edition, 'id' | 'number' | 'eventDate' | 'status' | 'bracketSize'>
  /** Which of the MC's vulgos was on the list that night. */
  vulgo: VulgoSummary
  arrivalNumber: number
  outcome: EntryOutcome
  battles: (HistoryBattle & { opponent: VulgoSummary | null })[]
}

/**
 * Battle history of one or more vulgos, most recent night first. Cancelled
 * editions are left out. Used by the MC dashboard and the public MC/vulgo
 * pages.
 */
export async function getHistoryForVulgos(vulgoIds: readonly VulgoId[]): Promise<HistoryEntry[]> {
  const input = await leagueReadModel.getVulgoHistoryInput(vulgoIds)
  if (input.entries.length === 0) return []

  const summaries = new Map(
    (await getVulgoSummaries([...input.entryVulgos.values()])).map((v) => [v.id, v]),
  )
  const vulgoOf = (entryId: EntryId | null) => {
    const vulgoId = entryId ? input.entryVulgos.get(entryId) : undefined
    return vulgoId ? (summaries.get(vulgoId) ?? null) : null
  }

  return input.entries.flatMap((entry) => {
    const vulgo = summaries.get(entry.vulgoId)
    if (!vulgo) return []
    const editionBattles = input.battles.filter((b) => b.editionId === entry.editionId)
    const { edition } = entry
    return [
      {
        league: entry.league,
        edition: {
          id: edition.id,
          number: edition.number,
          eventDate: edition.eventDate,
          status: edition.status,
          bracketSize: edition.bracketSize,
        },
        vulgo,
        arrivalNumber: entry.number,
        outcome: outcomeOf(entry, edition, editionBattles),
        battles: edition.bracketSize
          ? battlesFor(entry.id, edition.bracketSize, editionBattles, input.rounds).map((b) => ({
              ...b,
              opponent: vulgoOf(b.opponentEntryId),
            }))
          : [],
      },
    ]
  })
}
