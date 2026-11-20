import { ConflictError, ValidationError } from '@/shared/lib/errors/base'
import type { CrowdDrawId, EditionId, EntryId } from '@/shared/lib/ids'
import { err, ok, type Result } from '@/shared/lib/result'

import type { BracketSize, Entry } from './edition'

/**
 * Selection rule (docs/mvp-spec.md, "Battle night", step 2):
 *
 * | names | bracket | by arrival | crowd draw |
 * | ----- | ------- | ---------- | ---------- |
 * | 8     | 8       | all        | -          |
 * | 9–15  | 8       | first 6    | 2          |
 * | 16    | 16      | all        | -          |
 * | 17+   | 16      | first 12   | 4          |
 */
export type SelectionPlan = { bracketSize: BracketSize; byArrival: number; drawSlots: number }

export const MIN_ENTRIES = 8

export function planSelection(entryCount: number): Result<SelectionPlan, ConflictError> {
  if (entryCount < MIN_ENTRIES) {
    return err(new ConflictError(`at least ${MIN_ENTRIES} names are needed (${entryCount} so far)`))
  }
  if (entryCount === 8) return ok({ bracketSize: 8, byArrival: 8, drawSlots: 0 })
  if (entryCount < 16) return ok({ bracketSize: 8, byArrival: 6, drawSlots: 2 })
  if (entryCount === 16) return ok({ bracketSize: 16, byArrival: 16, drawSlots: 0 })
  return ok({ bracketSize: 16, byArrival: 12, drawSlots: 4 })
}

/** Splits the list (by arrival number) into guaranteed slots and the draw pool. */
export function splitByArrival(
  entries: readonly Entry[],
  plan: SelectionPlan,
): { byArrival: EntryId[]; pool: EntryId[] } {
  const ordered = [...entries].sort((a, b) => a.number - b.number).map((e) => e.id)
  return { byArrival: ordered.slice(0, plan.byArrival), pool: ordered.slice(plan.byArrival) }
}

/** Uniform random integer in `[0, maxExclusive)`. */
export type RandomIndex = (maxExclusive: number) => number

/** Fisher–Yates shuffle (does not mutate `items`). */
export function shuffle<T>(items: readonly T[], randomIndex: RandomIndex): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1)
    ;[copy[i], copy[j]] = [copy[j]!, copy[i]!]
  }
  return copy
}

export type Ticket = { entryId: EntryId; number: number }

/**
 * Crowd draw list: the pool gets numbers 1..X in random order, never their
 * arrival numbers, so the crowd cannot aim at a name or favor early arrivals.
 */
export function numberTickets(pool: readonly EntryId[], randomIndex: RandomIndex): Ticket[] {
  return shuffle(pool, randomIndex).map((entryId, index) => ({ entryId, number: index + 1 }))
}

/** The entries behind the numbers the crowd called out. */
export function resolvePicks(
  tickets: readonly Ticket[],
  numbers: readonly number[],
  slots: number,
): Result<EntryId[], ValidationError> {
  const invalid = (message: string) =>
    err(
      new ValidationError({ formErrors: [], fieldErrors: { numbers: [message] } }, 'Invalid picks'),
    )

  if (numbers.length !== slots) return invalid(`pick exactly ${slots} number(s)`)
  if (new Set(numbers).size !== numbers.length) return invalid('numbers must be different')

  const byNumber = new Map(tickets.map((t) => [t.number, t.entryId]))
  const picked: EntryId[] = []
  for (const number of numbers) {
    const entryId = byNumber.get(number)
    if (!entryId) return invalid(`number ${number} is not in 1..${tickets.length}`)
    picked.push(entryId)
  }
  return ok(picked)
}

export type CrowdDrawReason = 'selection' | 'replacement'

/** A crowd draw with its number → entry list (organizers/admins only). */
export type CrowdDraw = {
  id: CrowdDrawId
  editionId: EditionId
  reason: CrowdDrawReason
  slots: number
  createdAt: Date
  completedAt: Date | null
  tickets: (Ticket & { picked: boolean })[]
}
