import { z } from 'zod'

import { BattleIdSchema } from '@/shared/lib/ids'

const votes = z.number().int().min(0).max(100_000)

export const recordRoundSchema = z
  .object({
    battleId: BattleIdSchema,
    /** Crowd votes for the MC in slot A / slot B, tiebreaker included. */
    votesA: votes,
    votesB: votes,
  })
  .refine((round) => round.votesA !== round.votesB, {
    message: 'a round cannot tie; include the tiebreaker vote',
    path: ['votesB'],
  })

export type RecordRoundInput = z.input<typeof recordRoundSchema>
