import { ConflictError } from '@/shared/lib/errors/base'
import type { EditionId, EntryId, LeagueId, VulgoId } from '@/shared/lib/ids'
import { err, ok, type Result } from '@/shared/lib/result'

/**
 *   registration ──close list──▶ selection ──picks entered──▶ in_progress ──final──▶ completed
 *        ▲                          │   (8 or 16 names: straight to in_progress)
 *        └───────reopen list────────┘
 *   any status before completed ──▶ cancelled
 */
export type EditionStatus = 'registration' | 'selection' | 'in_progress' | 'completed' | 'cancelled'

export type BracketSize = 8 | 16

export type Edition = {
  id: EditionId
  leagueId: LeagueId
  number: number
  /** Calendar date of the night, `YYYY-MM-DD`. */
  eventDate: string
  status: EditionStatus
  bracketSize: BracketSize | null
  createdAt: Date
  updatedAt: Date
}

export type EntryStatus = 'registered' | 'selected' | 'not_selected' | 'withdrew'
export type EntrySelection = 'arrival' | 'draw' | 'replacement'

/** A name on the night's list. `number` is the arrival position. */
export type Entry = {
  id: EntryId
  editionId: EditionId
  vulgoId: VulgoId
  number: number
  status: EntryStatus
  selectedBy: EntrySelection | null
  createdAt: Date
}

/** Sanity cap on one night's list. */
export const MAX_ENTRIES = 200

export function ensureStatus(
  edition: Edition,
  allowed: readonly EditionStatus[],
  action: string,
): Result<void, ConflictError> {
  return allowed.includes(edition.status)
    ? ok(undefined)
    : err(new ConflictError(`cannot ${action} while the edition is ${edition.status}`))
}

export function ensureCanCancel(edition: Edition): Result<void, ConflictError> {
  return ensureStatus(edition, ['registration', 'selection', 'in_progress'], 'cancel')
}
