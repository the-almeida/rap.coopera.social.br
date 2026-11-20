'use server'

import { ValidationError } from '@/shared/lib/errors/base'
import { withErrorBoundary } from '@/shared/lib/errors/with-error-boundary'
import { err, ok } from '@/shared/lib/result'

import { requireUser } from '@/modules/auth'

import { editionRepository } from '../../adapters/edition-repository.drizzle'
import { authorizeEdition } from '../../authorize'
import { ensureCanCancel } from '../../domain/edition'

import { editionRefSchema } from './cancel-edition.schema'

/**
 * Cancels a night that did not happen or could not finish. The record stays
 * for audit, but cancelled editions never appear in MC histories.
 */
export const cancelEdition = withErrorBoundary(async (raw: unknown) => {
  const userResult = await requireUser()
  if (!userResult.ok) return userResult

  const parsed = editionRefSchema.safeParse(raw)
  if (!parsed.success) return err(new ValidationError(parsed.error.flatten()))

  const authz = await authorizeEdition(userResult.value, parsed.data, 'run-edition')
  if (!authz.ok) return authz

  return editionRepository.withLock(authz.value.edition.id, async (uow) => {
    const allowed = ensureCanCancel(uow.edition)
    if (!allowed.ok) return allowed
    return ok(await uow.updateEdition({ status: 'cancelled' }))
  })
})
