'use server'

import { ValidationError } from '@/shared/lib/errors/base'
import { withErrorBoundary } from '@/shared/lib/errors/with-error-boundary'
import { err, ok } from '@/shared/lib/result'

import { requireUser } from '@/modules/auth'

import { editionRepository } from '../../adapters/edition-repository.drizzle'
import { authorizeEdition } from '../../authorize'
import { ensureStatus } from '../../domain/edition'

import { entryRefSchema } from './remove-entry.schema'

/** Removes a name while the list is open; later names move up one number. */
export const removeEntry = withErrorBoundary(async (raw: unknown) => {
  const userResult = await requireUser()
  if (!userResult.ok) return userResult

  const parsed = entryRefSchema.safeParse(raw)
  if (!parsed.success) return err(new ValidationError(parsed.error.flatten()))

  const authz = await authorizeEdition(userResult.value, parsed.data, 'run-edition')
  if (!authz.ok) return authz

  return editionRepository.withLock(authz.value.edition.id, async (uow) => {
    const open = ensureStatus(uow.edition, ['registration'], 'remove names')
    if (!open.ok) return open
    await uow.removeEntry(parsed.data.entryId)
    return ok(await uow.listEntries())
  })
})
