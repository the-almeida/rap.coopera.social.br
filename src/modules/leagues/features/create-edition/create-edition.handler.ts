'use server'

import { ValidationError } from '@/shared/lib/errors/base'
import { withErrorBoundary } from '@/shared/lib/errors/with-error-boundary'
import { err, ok } from '@/shared/lib/result'

import { requireUser } from '@/modules/auth'

import { editionRepository } from '../../adapters/edition-repository.drizzle'
import { authorizeLeague } from '../../authorize'

import { createEditionSchema } from './create-edition.schema'

/** Opens a new battle night (next number in the league), ready for names. */
export const createEdition = withErrorBoundary(async (raw: unknown) => {
  const userResult = await requireUser()
  if (!userResult.ok) return userResult

  const parsed = createEditionSchema.safeParse(raw)
  if (!parsed.success) return err(new ValidationError(parsed.error.flatten()))

  const access = await authorizeLeague(userResult.value, parsed.data.leagueId, 'run-edition')
  if (!access.ok) return access

  return ok(
    await editionRepository.create({
      leagueId: access.value.league.id,
      eventDate: parsed.data.eventDate,
    }),
  )
})
