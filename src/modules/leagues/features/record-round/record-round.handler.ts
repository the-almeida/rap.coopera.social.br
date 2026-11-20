'use server'

import { ValidationError } from '@/shared/lib/errors/base'
import { withErrorBoundary } from '@/shared/lib/errors/with-error-boundary'
import { err, ok } from '@/shared/lib/result'

import { requireUser } from '@/modules/auth'

import { editionRepository } from '../../adapters/edition-repository.drizzle'
import { authorizeEdition } from '../../authorize'
import { applyChanges, recordRound as planRound } from '../../domain/bracket'
import { ensureStatus } from '../../domain/edition'
import { syncCompletion } from '../../night'

import { recordRoundSchema } from './record-round.schema'

/**
 * Records the crowd's votes for the next round of a battle. The round
 * number is implied (1, 2, then 3 only at 1-1). When an MC reaches two
 * round wins the battle is decided and they advance; deciding the final
 * completes the edition. Organizers may record their own battles.
 */
export const recordRound = withErrorBoundary(async (raw: unknown) => {
  const userResult = await requireUser()
  if (!userResult.ok) return userResult
  const user = userResult.value

  const parsed = recordRoundSchema.safeParse(raw)
  if (!parsed.success) return err(new ValidationError(parsed.error.flatten()))
  const { battleId, votesA, votesB } = parsed.data

  const authz = await authorizeEdition(user, { battleId }, 'run-edition')
  if (!authz.ok) return authz

  return editionRepository.withLock(authz.value.edition.id, async (uow) => {
    const live = ensureStatus(uow.edition, ['in_progress'], 'record rounds')
    if (!live.ok) return live

    const [battles, rounds, entries] = await Promise.all([
      uow.listBattles(),
      uow.listRounds(),
      uow.listEntries(),
    ])
    const unavailable = new Set(entries.filter((e) => e.status === 'withdrew').map((e) => e.id))
    const planned = planRound({ battles, rounds, battleId, votesA, votesB, unavailable })
    if (!planned.ok) return planned

    const round = await uow.insertRound({
      battleId,
      roundNo: planned.value.roundNo,
      votesA,
      votesB,
      recordedBy: user.id,
    })
    await uow.applyBattleChanges(planned.value.changes)
    const after = applyChanges(battles, planned.value.changes)
    const edition = await syncCompletion(uow, after)
    return ok({ edition, round, battle: after.find((b) => b.id === battleId)! })
  })
})
