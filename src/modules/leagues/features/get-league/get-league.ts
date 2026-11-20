import { z } from 'zod'

import type { LeagueId } from '@/shared/lib/ids'
import { slugSchema } from '@/shared/lib/validation'

import { leagueReadModel } from '../../adapters/league-read-model.drizzle'
import { leagueRepository } from '../../adapters/league-repository.drizzle'
import type { Edition } from '../../domain/edition'
import type { League } from '../../domain/league'

/** Public reads for league pages and the JSON API. */

export async function getLeagueBySlug(slug: string): Promise<League | null> {
  if (!slugSchema.safeParse(slug).success) return null
  return leagueRepository.findBySlug(slug)
}

export const pagingSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
})

export type PagingInput = z.input<typeof pagingSchema>

export type Paginated<T> = { items: T[]; page: number; perPage: number; total: number }

/** Editions of a league, most recent night first. */
export async function listLeagueEditions(
  leagueId: LeagueId,
  paging: PagingInput = {},
): Promise<Paginated<Edition & { entryCount: number }>> {
  const parsed = pagingSchema.safeParse(paging)
  const { page, perPage } = parsed.success ? parsed.data : pagingSchema.parse({})
  const { items, total } = await leagueReadModel.listEditions(leagueId, { page, perPage })
  return { items, page, perPage, total }
}
