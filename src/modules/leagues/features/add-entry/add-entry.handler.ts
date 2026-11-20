'use server'

import { ConflictError, NotFoundError, ValidationError } from '@/shared/lib/errors/base'
import { withErrorBoundary } from '@/shared/lib/errors/with-error-boundary'
import { rateLimit } from '@/shared/lib/rate-limit'
import { err, ok } from '@/shared/lib/result'

import { requireUser } from '@/modules/auth'
import { findOrCreateVulgo, getVulgoById } from '@/modules/mcs'

import { editionRepository } from '../../adapters/edition-repository.drizzle'
import { authorizeEdition } from '../../authorize'
import { ensureStatus, MAX_ENTRIES } from '../../domain/edition'

import { addEntrySchema } from './add-entry.schema'

/**
 * Adds a name to the night's list, at the end (arrival order). The entry's
 * number is its arrival position.
 */
export const addEntry = withErrorBoundary(async (raw: unknown) => {
  const userResult = await requireUser()
  if (!userResult.ok) return userResult
  const user = userResult.value

  const parsed = addEntrySchema.safeParse(raw)
  if (!parsed.success) return err(new ValidationError(parsed.error.flatten()))
  const input = parsed.data

  const authz = await authorizeEdition(user, { editionId: input.editionId }, 'run-edition')
  if (!authz.ok) return authz

  // Organizers type fast at the door; this only stops runaway scripts.
  const limit = await rateLimit(`leagues:add-entry:${user.id}`, {
    windowMs: 60 * 60 * 1000,
    max: 600,
  })
  if (!limit.ok) return limit

  // Checked again under the lock; this early check avoids creating a vulgo
  // for a list that is already closed.
  const open = ensureStatus(authz.value.edition, ['registration'], 'add names')
  if (!open.ok) return open

  let vulgo
  if ('vulgoId' in input) {
    vulgo = await getVulgoById(input.vulgoId)
    if (!vulgo) return err(new NotFoundError('vulgo not found'))
  } else {
    const found = await findOrCreateVulgo({ name: input.vulgoName, createdBy: user.id })
    if (!found.ok) return found
    vulgo = found.value
  }

  return editionRepository.withLock(authz.value.edition.id, async (uow) => {
    const stillOpen = ensureStatus(uow.edition, ['registration'], 'add names')
    if (!stillOpen.ok) return stillOpen
    const entries = await uow.listEntries()
    if (entries.some((e) => e.vulgoId === vulgo.id)) {
      return err(new ConflictError(`${vulgo.name} is already on the list`))
    }
    if (entries.length >= MAX_ENTRIES) {
      return err(new ConflictError(`the list is full (${MAX_ENTRIES} names)`))
    }
    const entry = await uow.appendEntry(vulgo.id)
    return ok({ ...entry, vulgo: { id: vulgo.id, name: vulgo.name, slug: vulgo.slug } })
  })
})
