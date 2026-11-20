import { z } from 'zod'

import { CrowdDrawIdSchema } from '@/shared/lib/ids'

export const submitCrowdDrawPicksSchema = z.object({
  drawId: CrowdDrawIdSchema,
  /** The numbers the crowd called out (2 or 4 for selection, 1 for a replacement). */
  numbers: z.array(z.number().int().min(1)).min(1).max(4),
})

export type SubmitCrowdDrawPicksInput = z.input<typeof submitCrowdDrawPicksSchema>
