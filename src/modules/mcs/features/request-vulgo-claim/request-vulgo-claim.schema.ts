import { z } from 'zod'

import { VulgoIdSchema } from '@/shared/lib/ids'

export const requestVulgoClaimSchema = z.object({ vulgoId: VulgoIdSchema })

export type RequestVulgoClaimInput = z.input<typeof requestVulgoClaimSchema>
