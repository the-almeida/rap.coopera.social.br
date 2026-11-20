import { z } from 'zod'

import { LeagueIdSchema, UserIdSchema } from '@/shared/lib/ids'

export const removeLeagueOrganizerSchema = z.object({
  leagueId: LeagueIdSchema,
  userId: UserIdSchema,
})

export type RemoveLeagueOrganizerInput = z.input<typeof removeLeagueOrganizerSchema>
