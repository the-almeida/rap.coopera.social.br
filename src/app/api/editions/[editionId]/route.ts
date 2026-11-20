import { EditionIdSchema } from '@/shared/lib/ids'
import { jsonError, jsonOk, limitPublicRead } from '@/shared/lib/http/public-api'

import { getEditionDetails } from '@/modules/leagues'

/**
 * GET /api/editions/:editionId — the night's list, bracket and round votes.
 * Short CDN TTL: built for live screens and stream overlays. Crowd draw
 * lists are never included (organizers only).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ editionId: string }> },
) {
  const limited = await limitPublicRead(request, 'editions')
  if (limited) return limited

  const editionId = EditionIdSchema.safeParse((await params).editionId)
  if (!editionId.success) return jsonError(404, 'edition_not_found')

  const details = await getEditionDetails(editionId.data)
  if (!details) return jsonError(404, 'edition_not_found')
  return jsonOk(details, 5)
}
