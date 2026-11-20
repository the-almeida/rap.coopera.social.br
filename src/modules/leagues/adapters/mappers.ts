import type {
  BattleRoundRow,
  BattleRow,
  CrowdDrawRow,
  CrowdDrawTicketRow,
  EditionEntryRow,
  EditionRow,
  WithdrawalRow,
} from '@/shared/db/schema/editions'
import type { LeagueRow } from '@/shared/db/schema/leagues'

import type { Battle, BattleRound } from '../domain/bracket'
import type { BracketSize, Edition, Entry } from '../domain/edition'
import type { League } from '../domain/league'
import type { CrowdDraw } from '../domain/selection'
import type { Withdrawal } from '../domain/withdrawal'

export function toLeague(row: LeagueRow): League {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  }
}

export function toEdition(row: EditionRow): Edition {
  return {
    id: row.id,
    leagueId: row.leagueId,
    number: row.number,
    eventDate: row.eventDate,
    status: row.status,
    bracketSize: row.bracketSize as BracketSize | null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function toEntry(row: EditionEntryRow): Entry {
  return {
    id: row.id,
    editionId: row.editionId,
    vulgoId: row.vulgoId,
    number: row.number,
    status: row.status,
    selectedBy: row.selectedBy,
    createdAt: row.createdAt,
  }
}

export function toBattle(row: BattleRow): Battle {
  return {
    id: row.id,
    editionId: row.editionId,
    phase: row.phase,
    position: row.position,
    entryAId: row.entryAId,
    entryBId: row.entryBId,
    winnerEntryId: row.winnerEntryId,
  }
}

export function toRound(row: BattleRoundRow): BattleRound {
  return {
    id: row.id,
    battleId: row.battleId,
    roundNo: row.roundNo,
    votesA: row.votesA,
    votesB: row.votesB,
    recordedBy: row.recordedBy,
    recordedAt: row.recordedAt,
  }
}

export function toDraw(row: CrowdDrawRow, tickets: readonly CrowdDrawTicketRow[]): CrowdDraw {
  return {
    id: row.id,
    editionId: row.editionId,
    reason: row.reason,
    slots: row.slots,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    tickets: tickets
      .filter((t) => t.drawId === row.id)
      .sort((a, b) => a.number - b.number)
      .map((t) => ({ entryId: t.entryId, number: t.number, picked: t.picked })),
  }
}

export function toWithdrawal(row: WithdrawalRow): Withdrawal {
  return {
    id: row.id,
    editionId: row.editionId,
    entryId: row.entryId,
    battleId: row.battleId,
    replacementEntryId: row.replacementEntryId,
    method: row.method,
    crowdDrawId: row.crowdDrawId,
    recordedBy: row.recordedBy,
    recordedAt: row.recordedAt,
  }
}
