'use server'

import { ValidationError } from '@/shared/lib/errors/base'
import { withErrorBoundary } from '@/shared/lib/errors/with-error-boundary'
import { err, ok } from '@/shared/lib/result'

import { requireUser } from '@/modules/auth'

import { editionRepository } from '../../adapters/edition-repository.drizzle'
import { authorizeEdition } from '../../authorize'
import { ensureStatus } from '../../domain/edition'

import { moveEntrySchema } from './move-entry.schema'

/**
 * Fixes the arrival order (e.g. typing from a paper list). Arrival order
 * decides who is guaranteed a slot, so it can only change while the list
 * is open.
 */
export const moveEntry = withErrorBoundary(async (raw: unknown) => {
  const userResult = await requireUser()
  if (!userResult.ok) return userResult

  const parsed = moveEntrySchema.safeParse(raw)
  if (!parsed.success) return err(new ValidationError(parsed.error.flatten()))

  const authz = await authorizeEdition(
    userResult.value,
    { entryId: parsed.data.entryId },
    'run-edition',
  )
  if (!authz.ok) return authz

  return editionRepository.withLock(authz.value.edition.id, async (uow) => {
    const open = ensureStatus(uow.edition, ['registration'], 'reorder names')
    if (!open.ok) return open
    const entries = await uow.listEntries()
    if (parsed.data.toNumber > entries.length) {
      return err(
        new ValidationError(
          {
            formErrors: [],
            fieldErrors: { toNumber: [`must be between 1 and ${entries.length}`] },
          },
          'Invalid position',
        ),
      )
    }
    await uow.moveEntry(parsed.data.entryId, parsed.data.toNumber)
    return ok(await uow.listEntries())
  })
})
