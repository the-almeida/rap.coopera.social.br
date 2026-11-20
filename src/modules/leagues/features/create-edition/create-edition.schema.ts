import { z } from 'zod'

import { LeagueIdSchema } from '@/shared/lib/ids'

export const createEditionSchema = z.object({
  leagueId: LeagueIdSchema,
  /** Calendar date of the night, `YYYY-MM-DD`. */
  eventDate: z.iso.date(),
})

export type CreateEditionInput = z.input<typeof createEditionSchema>
