import { z } from 'zod'

import { EditionIdSchema } from '@/shared/lib/ids'

export const editionRefSchema = z.object({ editionId: EditionIdSchema })

export type EditionRefInput = z.input<typeof editionRefSchema>
