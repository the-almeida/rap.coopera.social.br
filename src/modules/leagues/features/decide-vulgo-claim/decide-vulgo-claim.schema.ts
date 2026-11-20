import { z } from 'zod'

import { VulgoClaimIdSchema } from '@/shared/lib/ids'

export const decideVulgoClaimSchema = z.object({
  claimId: VulgoClaimIdSchema,
  decision: z.enum(['approved', 'rejected']),
})

export type DecideVulgoClaimInput = z.input<typeof decideVulgoClaimSchema>
