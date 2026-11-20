import { z } from 'zod'

import { BattleIdSchema } from '@/shared/lib/ids'

export const battleRefSchema = z.object({ battleId: BattleIdSchema })

export type BattleRefInput = z.input<typeof battleRefSchema>
