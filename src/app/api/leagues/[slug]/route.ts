import { jsonError, jsonOk, limitPublicRead } from '@/shared/lib/http/public-api'

import { getLeagueBySlug, listLeagueEditions, pagingSchema } from '@/modules/leagues'

/** GET /api/leagues/:slug?page=1&perPage=20 — league and its editions, newest first. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const limited = await limitPublicRead(request, 'leagues')
  if (limited) return limited

  const league = await getLeagueBySlug((await params).slug)
  if (!league) return jsonError(404, 'league_not_found')

  const paging = pagingSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!paging.success) return jsonError(400, 'invalid_query')

  return jsonOk(
    {
      league: { id: league.id, name: league.name, slug: league.slug, createdAt: league.createdAt },
      editions: await listLeagueEditions(league.id, paging.data),
    },
    60,
  )
}
