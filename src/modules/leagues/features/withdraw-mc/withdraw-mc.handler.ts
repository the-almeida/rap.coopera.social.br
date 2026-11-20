'use server'

import { ValidationError } from '@/shared/lib/errors/base'
import { withErrorBoundary } from '@/shared/lib/errors/with-error-boundary'
import { err, ok } from '@/shared/lib/result'

import { requireUser } from '@/modules/auth'

import { editionRepository } from '../../adapters/edition-repository.drizzle'
import { authorizeEdition } from '../../authorize'
import { applyChanges } from '../../domain/bracket'
import { ensureStatus } from '../../domain/edition'
import { numberTickets } from '../../domain/selection'
import { planWithdrawal } from '../../domain/withdrawal'
import { secureRandomIndex, syncCompletion } from '../../night'
import { entryRefSchema } from '../remove-entry/remove-entry.schema'

/**
 * A selected MC leaves (exceptional). The rule that applies (see
 * `planWithdrawal`): walkover mid-battle, new crowd draw before their first
 * battle, or the MC they beat most recently takes their place. Their
 * history shows "withdrew".
 *
 * For a crowd draw, the organizer then enters the pick with
 * `submitCrowdDrawPicks`; the battle waits until then.
 */
export const withdrawMc = withErrorBoundary(async (raw: unknown) => {
  const userResult = await requireUser()
  if (!userResult.ok) return userResult
  const user = userResult.value

  const parsed = entryRefSchema.safeParse(raw)
  if (!parsed.success) return err(new ValidationError(parsed.error.flatten()))
  const { entryId } = parsed.data

  const authz = await authorizeEdition(user, { entryId }, 'run-edition')
  if (!authz.ok) return authz

  return editionRepository.withLock(authz.value.edition.id, async (uow) => {
    const live = ensureStatus(uow.edition, ['in_progress'], 'record withdrawals')
    if (!live.ok) return live

    const [entries, battles, rounds] = await Promise.all([
      uow.listEntries(),
      uow.listBattles(),
      uow.listRounds(),
    ])
    const entry = entries.find((e) => e.id === entryId)!
    const plan = planWithdrawal({ entry, entries, battles, rounds })
    if (!plan.ok) return plan

    await uow.setEntryStates([{ id: entry.id, status: 'withdrew', selectedBy: entry.selectedBy }])
    const base = { entryId: entry.id, battleId: plan.value.battleId, recordedBy: user.id }

    if (plan.value.method === 'crowd_draw') {
      const crowdDraw = await uow.insertDraw({
        reason: 'replacement',
        slots: 1,
        createdBy: user.id,
        tickets: numberTickets(plan.value.pool, secureRandomIndex),
      })
      const withdrawal = await uow.insertWithdrawal({
        ...base,
        method: 'crowd_draw',
        replacementEntryId: null,
        crowdDrawId: crowdDraw.id,
      })
      return ok({ edition: uow.edition, withdrawal, crowdDraw })
    }

    await uow.applyBattleChanges(plan.value.changes)
    const withdrawal = await uow.insertWithdrawal({
      ...base,
      method: plan.value.method,
      replacementEntryId:
        plan.value.method === 'previous_opponent' ? plan.value.replacementEntryId : null,
      crowdDrawId: null,
    })
    const edition = await syncCompletion(uow, applyChanges(battles, plan.value.changes))
    return ok({ edition, withdrawal, crowdDraw: null })
  })
})
