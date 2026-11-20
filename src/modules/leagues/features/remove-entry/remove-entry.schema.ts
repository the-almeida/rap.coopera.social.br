import { z } from 'zod'

import { EntryIdSchema } from '@/shared/lib/ids'

export const entryRefSchema = z.object({ entryId: EntryIdSchema })

export type EntryRefInput = z.input<typeof entryRefSchema>
