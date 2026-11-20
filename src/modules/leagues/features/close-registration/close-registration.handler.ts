'use server'

import { ValidationError } from '@/shared/lib/errors/base'
import { withErrorBoundary } from '@/shared/lib/errors/with-error-boundary'
import { err, ok } from '@/shared/lib/result'

import { requireUser } from '@/modules/auth'

import { editionRepository } from '../../adapters/edition-repository.drizzle'
import { authorizeEdition } from '../../authorize'
import { ensureStatus } from '../../domain/edition'
import { numberTickets, planSelection, splitByArrival } from '../../domain/selection'
import { drawBracket, secureRandomIndex } from '../../night'
import { editionRefSchema } from '../cancel-edition/cancel-edition.schema'

/**
 * Closes the list and applies the selection rule (docs/mvp-spec.md):
 * the earliest arrivals get their slots; the rest go into a crowd draw with
 * fresh random numbers 1..X. With exactly 8 or 16 names everyone battles
 * and the bracket is drawn right away.
 *
 * Returns the crowd draw (numbers → entries) for the organizer, or the
 * bracket when no draw was needed.
 */
export const closeRegistration = withErrorBoundary(async (raw: unknown) => {
  const userResult = await requireUser()
  if (!userResult.ok) return userResult
  const user = userResult.value

  const parsed = editionRefSchema.safeParse(raw)
  if (!parsed.success) return err(new ValidationError(parsed.error.flatten()))

  const authz = await authorizeEdition(user, parsed.data, 'run-edition')
  if (!authz.ok) return authz

  return editionRepository.withLock(authz.value.edition.id, async (uow) => {
    const open = ensureStatus(uow.edition, ['registration'], 'close the list')
    if (!open.ok) return open

    const entries = await uow.listEntries()
    const plan = planSelection(entries.length)
    if (!plan.ok) return plan

    const { byArrival, pool } = splitByArrival(entries, plan.value)
    await uow.setEntryStates(
      byArrival.map((id) => ({ id, status: 'selected' as const, selectedBy: 'arrival' as const })),
    )

    if (plan.value.drawSlots === 0) {
      const drawn = await drawBracket(uow, byArrival)
      if (!drawn.ok) return drawn
      return ok({ ...drawn.value, crowdDraw: null })
    }

    const crowdDraw = await uow.insertDraw({
      reason: 'selection',
      slots: plan.value.drawSlots,
      createdBy: user.id,
      tickets: numberTickets(pool, secureRandomIndex),
    })
    const edition = await uow.updateEdition({
      status: 'selection',
      bracketSize: plan.value.bracketSize,
    })
    return ok({ edition, battles: [], crowdDraw })
  })
})
