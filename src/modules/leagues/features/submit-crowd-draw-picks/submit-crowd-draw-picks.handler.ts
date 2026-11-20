'use server'

import { ConflictError, NotFoundError, ValidationError } from '@/shared/lib/errors/base'
import { withErrorBoundary } from '@/shared/lib/errors/with-error-boundary'
import { err, ok } from '@/shared/lib/result'

import { requireUser } from '@/modules/auth'

import { editionRepository } from '../../adapters/edition-repository.drizzle'
import { authorizeEdition } from '../../authorize'
import { ensureStatus } from '../../domain/edition'
import { resolvePicks } from '../../domain/selection'
import { replaceInBattle } from '../../domain/withdrawal'
import { drawBracket } from '../../night'

import { submitCrowdDrawPicksSchema } from './submit-crowd-draw-picks.schema'

/**
 * The organizer enters the numbers the crowd called out.
 *
 * - Selection draw: the picked MCs join the arrival slots, everyone else in
 *   the pool is "not selected", and the bracket is drawn.
 * - Replacement draw (a selected MC withdrew before their first battle):
 *   the picked MC takes the leaver's slot.
 */
export const submitCrowdDrawPicks = withErrorBoundary(async (raw: unknown) => {
  const userResult = await requireUser()
  if (!userResult.ok) return userResult

  const parsed = submitCrowdDrawPicksSchema.safeParse(raw)
  if (!parsed.success) return err(new ValidationError(parsed.error.flatten()))
  const { drawId, numbers } = parsed.data

  const authz = await authorizeEdition(userResult.value, { drawId }, 'run-edition')
  if (!authz.ok) return authz

  return editionRepository.withLock(authz.value.edition.id, async (uow) => {
    const draw = (await uow.listDraws()).find((d) => d.id === drawId)
    if (!draw) return err(new NotFoundError('crowd draw not found'))
    if (draw.completedAt) return err(new ConflictError('the crowd already picked for this draw'))

    const picked = resolvePicks(draw.tickets, numbers, draw.slots)
    if (!picked.ok) return picked

    if (draw.reason === 'selection') {
      const selecting = ensureStatus(uow.edition, ['selection'], 'enter selection picks')
      if (!selecting.ok) return selecting

      const chosen = new Set(picked.value)
      await uow.setEntryStates(
        draw.tickets.map((t) =>
          chosen.has(t.entryId)
            ? { id: t.entryId, status: 'selected' as const, selectedBy: 'draw' as const }
            : { id: t.entryId, status: 'not_selected' as const, selectedBy: null },
        ),
      )
      await uow.completeDraw(draw.id, picked.value)
      const selected = (await uow.listEntries())
        .filter((e) => e.status === 'selected')
        .map((e) => e.id)
      const drawn = await drawBracket(uow, selected)
      if (!drawn.ok) return drawn
      return ok({ edition: drawn.value.edition, picked: picked.value })
    }

    const live = ensureStatus(uow.edition, ['in_progress'], 'enter replacement picks')
    if (!live.ok) return live
    const withdrawal = (await uow.listWithdrawals()).find((w) => w.crowdDrawId === draw.id)
    if (!withdrawal) throw new Error(`replacement draw ${draw.id} has no withdrawal`)
    const battle = (await uow.listBattles()).find((b) => b.id === withdrawal.battleId)
    if (!battle) throw new Error(`withdrawal ${withdrawal.id} points at a missing battle`)

    const replacement = picked.value[0]!
    await uow.setEntryStates([{ id: replacement, status: 'selected', selectedBy: 'replacement' }])
    await uow.applyBattleChanges([replaceInBattle(battle, withdrawal.entryId, replacement)])
    await uow.setWithdrawalReplacement(withdrawal.id, replacement)
    await uow.completeDraw(draw.id, picked.value)
    return ok({ edition: uow.edition, picked: picked.value })
  })
})
