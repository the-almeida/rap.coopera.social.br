'use server'

import { ConflictError, ValidationError } from '@/shared/lib/errors/base'
import { withErrorBoundary } from '@/shared/lib/errors/with-error-boundary'
import { err } from '@/shared/lib/result'

import { requireUser } from '@/modules/auth'

import { editionRepository } from '../../adapters/edition-repository.drizzle'
import { authorizeEdition } from '../../authorize'
import { ensureStatus } from '../../domain/edition'
import { drawBracket } from '../../night'
import { editionRefSchema } from '../cancel-edition/cancel-edition.schema'

/** New random pairing of the same selected MCs, until the first round is recorded. */
export const redrawBracket = withErrorBoundary(async (raw: unknown) => {
  const userResult = await requireUser()
  if (!userResult.ok) return userResult

  const parsed = editionRefSchema.safeParse(raw)
  if (!parsed.success) return err(new ValidationError(parsed.error.flatten()))

  const authz = await authorizeEdition(userResult.value, parsed.data, 'run-edition')
  if (!authz.ok) return authz

  return editionRepository.withLock(authz.value.edition.id, async (uow) => {
    const live = ensureStatus(uow.edition, ['in_progress'], 'redraw the bracket')
    if (!live.ok) return live
    const [rounds, withdrawals, battles] = await Promise.all([
      uow.listRounds(),
      uow.listWithdrawals(),
      uow.listBattles(),
    ])
    if (rounds.length > 0 || withdrawals.length > 0 || battles.some((b) => b.winnerEntryId)) {
      return err(new ConflictError('the bracket is locked once the first round is recorded'))
    }

    await uow.deleteBattles()
    const selected = (await uow.listEntries())
      .filter((e) => e.status === 'selected')
      .map((e) => e.id)
    return drawBracket(uow, selected)
  })
})
