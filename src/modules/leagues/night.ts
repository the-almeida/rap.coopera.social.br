import { randomInt } from 'node:crypto'

import type { ConflictError } from '@/shared/lib/errors/base'
import type { EntryId } from '@/shared/lib/ids'
import { ok, type Result } from '@/shared/lib/result'
import { Events } from '@/shared/observability/analytics/events'
import { track } from '@/shared/observability/analytics/track'

import { type Battle, championOf, planBracket } from './domain/bracket'
import type { BracketSize, Edition } from './domain/edition'
import type { RandomIndex } from './domain/selection'
import type { EditionUnitOfWork } from './adapters/edition-unit-of-work'

/**
 * Steps shared by several battle-night handlers. Internal to the module.
 */

// Draws decide who battles whom; MCs and crowds notice a rigged one.
// `crypto.randomInt` is a CSPRNG and exactly uniform over [0, n).
export const secureRandomIndex: RandomIndex = (maxExclusive) => randomInt(maxExclusive)

/** Randomly pairs `selected` into a fresh bracket and starts the night. */
export async function drawBracket(
  uow: EditionUnitOfWork,
  selected: readonly EntryId[],
): Promise<Result<{ edition: Edition; battles: Battle[] }, ConflictError>> {
  const planned = planBracket(selected, secureRandomIndex)
  if (!planned.ok) return planned
  const battles = await uow.insertBattles(planned.value)
  const edition = await uow.updateEdition({
    status: 'in_progress',
    bracketSize: selected.length as BracketSize,
  })
  track(Events.BRACKET_DRAWN, {
    bracketSize: selected.length as BracketSize,
    entries: (await uow.listEntries()).length,
  })
  return ok({ edition, battles })
}

/**
 * Keeps the edition status in line with the final: a decided final
 * completes the night, undoing it reopens it.
 */
export async function syncCompletion(uow: EditionUnitOfWork, battles: readonly Battle[]) {
  const champion = championOf(battles)
  const status = champion ? 'completed' : 'in_progress'
  if (uow.edition.status === status) return uow.edition
  const edition = await uow.updateEdition({ status })
  if (status === 'completed' && edition.bracketSize) {
    track(Events.EDITION_COMPLETED, { bracketSize: edition.bracketSize })
  }
  return edition
}
