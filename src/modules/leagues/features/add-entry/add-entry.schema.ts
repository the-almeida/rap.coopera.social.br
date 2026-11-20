import { z } from 'zod'

import { EditionIdSchema, VulgoIdSchema } from '@/shared/lib/ids'

export const addEntrySchema = z.union([
  /** Picked from the autocomplete (`searchVulgos`). */
  z.object({ editionId: EditionIdSchema, vulgoId: VulgoIdSchema }),
  /** Typed: reuses the vulgo with the same name (accent/case-insensitive) or creates it. */
  z.object({ editionId: EditionIdSchema, vulgoName: z.string().trim().min(1).max(60) }),
])

export type AddEntryInput = z.input<typeof addEntrySchema>
