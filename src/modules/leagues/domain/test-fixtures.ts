import {
  BattleIdSchema,
  BattleRoundIdSchema,
  EditionIdSchema,
  EntryIdSchema,
  LeagueIdSchema,
  VulgoIdSchema,
  type BattleId,
} from '@/shared/lib/ids'

import type { Battle, BattleRound, PlannedBattle } from './bracket'
import type { Edition, Entry, EntryStatus } from './edition'

/** Shared builders for the domain unit tests. */

const uuid = (prefix: string, n: number) =>
  `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`

export const editionId = EditionIdSchema.parse(uuid('e', 1))
export const entryId = (n: number) => EntryIdSchema.parse(uuid('1', n))
export const now = new Date('2026-11-14T23:00:00Z')

/** Deterministic `randomIndex` so draws are reproducible. */
export function seededIndex(seed = 42): (maxExclusive: number) => number {
  let state = seed
  return (maxExclusive) => {
    state = (state * 1664525 + 1013904223) % 2 ** 32
    return Math.floor((state / 2 ** 32) * maxExclusive)
  }
}

export function entry(n: number, status: EntryStatus = 'selected'): Entry {
  return {
    id: entryId(n),
    editionId,
    vulgoId: VulgoIdSchema.parse(uuid('2', n)),
    number: n,
    status,
    selectedBy: status === 'selected' || status === 'withdrew' ? 'arrival' : null,
    createdAt: now,
  }
}

export function edition(overrides: Partial<Edition> = {}): Edition {
  return {
    id: editionId,
    leagueId: LeagueIdSchema.parse(uuid('3', 1)),
    number: 1,
    eventDate: '2026-11-14',
    status: 'in_progress',
    bracketSize: 8,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function persist(planned: readonly PlannedBattle[]): Battle[] {
  return planned.map((b, i) => ({ ...b, id: BattleIdSchema.parse(uuid('4', i + 1)), editionId }))
}

/** An 8-bracket with entries 1..8 paired in order: 1v2, 3v4, 5v6, 7v8. */
export function orderedBracket(): Battle[] {
  const planned: PlannedBattle[] = []
  for (let phase = 1; phase <= 3; phase++) {
    for (let position = 1; position <= 8 / 2 ** phase; position++) {
      planned.push({
        phase,
        position,
        entryAId: phase === 1 ? entryId(position * 2 - 1) : null,
        entryBId: phase === 1 ? entryId(position * 2) : null,
        winnerEntryId: null,
      })
    }
  }
  return persist(planned)
}

let roundSeq = 0
export function round(
  battleId: BattleId,
  roundNo: number,
  votesA: number,
  votesB: number,
): BattleRound {
  roundSeq++
  return {
    id: BattleRoundIdSchema.parse(uuid('5', roundSeq)),
    battleId,
    roundNo,
    votesA,
    votesB,
    recordedBy: null,
    recordedAt: now,
  }
}

export const at = (battles: readonly Battle[], phase: number, position: number) =>
  battles.find((b) => b.phase === phase && b.position === position)!
