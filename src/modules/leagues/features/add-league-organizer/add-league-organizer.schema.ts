import { z } from 'zod'

import { LeagueIdSchema } from '@/shared/lib/ids'

import { AccountLoginSchema } from '@/modules/auth/client'

export const addLeagueOrganizerSchema = z.object({
  leagueId: LeagueIdSchema,
  /** The MC must already have an account: its email, or its nickname for a guest account. */
  login: AccountLoginSchema,
})

export type AddLeagueOrganizerInput = z.input<typeof addLeagueOrganizerSchema>
