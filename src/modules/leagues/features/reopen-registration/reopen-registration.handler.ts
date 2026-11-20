'use server'

import { ValidationError } from '@/shared/lib/errors/base'
import { withErrorBoundary } from '@/shared/lib/errors/with-error-boundary'
import { err, ok } from '@/shared/lib/result'

import { requireUser } from '@/modules/auth'

import { editionRepository } from '../../adapters/edition-repository.drizzle'
import { authorizeEdition } from '../../authorize'
import { ensureStatus } from '../../domain/edition'
import { editionRefSchema } from '../cancel-edition/cancel-edition.schema'

/**
 * Undoes "close the list" (closed too early, someone arrived late) as long
 * as the crowd has not picked yet. The pending crowd draw is discarded.
 */
export const reopenRegistration = withErrorBoundary(async (raw: unknown) => {
  const userResult = await requireUser()
  if (!userResult.ok) return userResult

  const parsed = editionRefSchema.safeParse(raw)
  if (!parsed.success) return err(new ValidationError(parsed.error.flatten()))

  const authz = await authorizeEdition(userResult.value, parsed.data, 'run-edition')
  if (!authz.ok) return authz

  return editionRepository.withLock(authz.value.edition.id, async (uow) => {
    const pending = ensureStatus(uow.edition, ['selection'], 'reopen the list')
    if (!pending.ok) return pending

    await uow.deleteDraws()
    const entries = await uow.listEntries()
    await uow.setEntryStates(
      entries.map((e) => ({ id: e.id, status: 'registered' as const, selectedBy: null })),
    )
    return ok(await uow.updateEdition({ status: 'registration', bracketSize: null }))
  })
})
