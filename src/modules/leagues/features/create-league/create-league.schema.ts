import { z } from 'zod'

import { requiredText, slugSchema } from '@/shared/lib/validation'

export const createLeagueSchema = z.object({
  name: requiredText(80),
  /** Optional custom URL slug; derived from the name when omitted. */
  slug: slugSchema.max(64).optional(),
})

export type CreateLeagueInput = z.input<typeof createLeagueSchema>
