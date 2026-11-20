import { jsonError, jsonOk, limitPublicRead } from '@/shared/lib/http/public-api'

import { getVulgoPage } from '@/modules/leagues'

/** GET /api/vulgos/:slug — a vulgo's history (claimed or not) and its owner, if any. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const limited = await limitPublicRead(request, 'vulgos')
  if (limited) return limited

  const page = await getVulgoPage((await params).slug)
  if (!page) return jsonError(404, 'vulgo_not_found')
  return jsonOk(page, 60)
}
