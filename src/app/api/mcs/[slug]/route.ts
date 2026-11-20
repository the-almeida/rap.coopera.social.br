import { jsonError, jsonOk, limitPublicRead } from '@/shared/lib/http/public-api'

import { getMcPage } from '@/modules/leagues'

/** GET /api/mcs/:slug — an MC's vulgos and battle history across leagues. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const limited = await limitPublicRead(request, 'mcs')
  if (limited) return limited

  const page = await getMcPage((await params).slug)
  if (!page) return jsonError(404, 'mc_not_found')
  return jsonOk(page, 60)
}
