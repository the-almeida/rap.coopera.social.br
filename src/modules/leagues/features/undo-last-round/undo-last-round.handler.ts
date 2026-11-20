'use server'

import { ValidationError } from '@/shared/lib/errors/base'
import { withErrorBoundary } from '@/shared/lib/errors/with-error-boundary'
import { err, ok } from '@/shared/lib/result'

import { requireUser } from '@/modules/auth'

import { editionRepository } from '../../adapters/edition-repository.drizzle'
import { authorizeEdition } from '../../authorize'
import { applyChanges, undoLastRound as planUndo } from '../../domain/bracket'
import { ensureStatus } from '../../domain/edition'
import { syncCompletion } from '../../night'

import { battleRefSchema } from './undo-last-round.schema'

/**
 * Removes the last recorded round of a battle (mistyped votes). If it had
 * decided the battle, the winner leaves the next battle again; undoing the
 * final reopens a completed edition.
 */
export const undoLastRound = withErrorBoundary(async (raw: unknown) => {
  const userResult = await requireUser()
  if (!userResult.ok) return userResult

  const parsed = battleRefSchema.safeParse(raw)
  if (!parsed.success) return err(new ValidationError(parsed.error.flatten()))
  const { battleId } = parsed.data

  const authz = await authorizeEdition(userResult.value, { battleId }, 'run-edition')
  if (!authz.ok) return authz

  return editionRepository.withLock(authz.value.edition.id, async (uow) => {
    const editable = ensureStatus(uow.edition, ['in_progress', 'completed'], 'undo rounds')
    if (!editable.ok) return editable

    const [battles, rounds] = await Promise.all([uow.listBattles(), uow.listRounds()])
    const planned = planUndo({ battles, rounds, battleId })
    if (!planned.ok) return planned

    await uow.deleteRound(planned.value.roundId)
    await uow.applyBattleChanges(planned.value.changes)
    const after = applyChanges(battles, planned.value.changes)
    const edition = await syncCompletion(uow, after)
    return ok({ edition, battle: after.find((b) => b.id === battleId)! })
  })
})
