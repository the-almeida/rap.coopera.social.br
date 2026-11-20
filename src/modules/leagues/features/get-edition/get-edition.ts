import type { EditionId, EntryId, UserId } from '@/shared/lib/ids'

import { getUserProfiles } from '@/modules/auth'
import { getVulgoSummaries, type VulgoSummary } from '@/modules/mcs'

import { editionRepository } from '../../adapters/edition-repository.drizzle'
import { leagueReadModel } from '../../adapters/league-read-model.drizzle'
import { leagueRepository } from '../../adapters/league-repository.drizzle'
import {
  type Battle,
  type BattleState,
  battleState,
  championOf,
  roundsOf,
  tally,
} from '../../domain/bracket'
import type { Edition, Entry } from '../../domain/edition'
import { type EntryOutcome, outcomeOf, type Stage, stageOf } from '../../domain/history'
import type { League } from '../../domain/league'
import type { CrowdDrawReason } from '../../domain/selection'
import type { WithdrawalMethod } from '../../domain/withdrawal'

export type BattleView = Battle & {
  state: BattleState
  mcA: VulgoSummary | null
  mcB: VulgoSummary | null
  winsA: number
  winsB: number
  walkover: boolean
  rounds: {
    roundNo: number
    votesA: number
    votesB: number
    /** Organizer who typed the votes (public, for community auditing). */
    recordedBy: string | null
    recordedAt: Date
  }[]
}

export type EditionDetails = {
  edition: Edition
  league: Pick<League, 'id' | 'name' | 'slug'>
  /** The night's list in arrival order. */
  entries: (Entry & { vulgo: VulgoSummary; outcome: EntryOutcome })[]
  bracket: { phase: number; stage: Stage; battles: BattleView[] }[]
  withdrawals: {
    entryId: EntryId
    method: WithdrawalMethod
    replacementEntryId: EntryId | null
    recordedAt: Date
  }[]
  /**
   * A crowd draw waiting for the crowd's numbers. Only the range is public:
   * which number belongs to which MC is visible to organizers only
   * (`getCrowdDraws`).
   */
  pendingDraw: { reason: CrowdDrawReason; slots: number; range: number } | null
  champion: VulgoSummary | null
}

/**
 * Everything a public edition page, the organizer's live screen or a stream
 * overlay needs. Never includes crowd draw lists.
 */
export async function getEditionDetails(editionId: EditionId): Promise<EditionDetails | null> {
  const edition = await editionRepository.findById(editionId)
  if (!edition) return null
  const [league, snapshot] = await Promise.all([
    leagueRepository.findById(edition.leagueId),
    leagueReadModel.getEditionSnapshot(edition.id),
  ])
  if (!league) return null

  const vulgos = new Map(
    (await getVulgoSummaries(snapshot.entries.map((e) => e.vulgoId))).map((v) => [v.id, v]),
  )
  const recorders = new Map(
    (
      await getUserProfiles(
        snapshot.rounds.map((r) => r.recordedBy).filter((id): id is UserId => id !== null),
      )
    ).map((p) => [p.id, p.name]),
  )
  const entryById = new Map(snapshot.entries.map((e) => [e.id, e]))
  const vulgoOfEntry = (entryId: EntryId | null) => {
    const entry = entryId ? entryById.get(entryId) : undefined
    return entry ? (vulgos.get(entry.vulgoId) ?? null) : null
  }
  const unavailable = new Set(
    snapshot.entries.filter((e) => e.status === 'withdrew').map((e) => e.id),
  )

  const phases = [...new Set(snapshot.battles.map((b) => b.phase))].sort((a, b) => a - b)
  const bracket = edition.bracketSize
    ? phases.map((phase) => ({
        phase,
        stage: stageOf(phase, edition.bracketSize!),
        battles: snapshot.battles
          .filter((b) => b.phase === phase)
          .map((battle): BattleView => {
            const rounds = roundsOf(snapshot.rounds, battle.id)
            const { winsA, winsB } = tally(rounds)
            return {
              ...battle,
              state: battleState(battle, snapshot.rounds, unavailable),
              mcA: vulgoOfEntry(battle.entryAId),
              mcB: vulgoOfEntry(battle.entryBId),
              winsA,
              winsB,
              walkover: Boolean(battle.winnerEntryId) && rounds.length === 0,
              rounds: rounds.map((r) => ({
                roundNo: r.roundNo,
                votesA: r.votesA,
                votesB: r.votesB,
                recordedBy: r.recordedBy ? (recorders.get(r.recordedBy) ?? null) : null,
                recordedAt: r.recordedAt,
              })),
            }
          }),
      }))
    : []

  const pending = snapshot.draws.find((d) => !d.completedAt)
  return {
    edition,
    league: { id: league.id, name: league.name, slug: league.slug },
    entries: snapshot.entries.flatMap((entry) => {
      const vulgo = vulgos.get(entry.vulgoId)
      return vulgo
        ? [{ ...entry, vulgo, outcome: outcomeOf(entry, edition, snapshot.battles) }]
        : []
    }),
    bracket,
    withdrawals: snapshot.withdrawals.map((w) => ({
      entryId: w.entryId,
      method: w.method,
      replacementEntryId: w.replacementEntryId,
      recordedAt: w.recordedAt,
    })),
    pendingDraw: pending
      ? { reason: pending.reason, slots: pending.slots, range: pending.tickets.length }
      : null,
    champion: vulgoOfEntry(championOf(snapshot.battles)),
  }
}
