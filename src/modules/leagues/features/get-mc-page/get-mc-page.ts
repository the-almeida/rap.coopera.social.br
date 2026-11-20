import {
  getMcProfileBySlug,
  getVulgoBySlug,
  getVulgoSummaries,
  type VulgoSummary,
} from '@/modules/mcs'

import { getHistoryForVulgos, type HistoryEntry } from '../vulgo-history/vulgo-history'

/** Public page of an MC: their vulgos and full history. */
export async function getMcPage(
  slug: string,
): Promise<{ profileSlug: string; vulgos: VulgoSummary[]; history: HistoryEntry[] } | null> {
  const found = await getMcProfileBySlug(slug)
  if (!found) return null
  const ids = found.vulgos.map((v) => v.id)
  const [vulgos, history] = await Promise.all([getVulgoSummaries(ids), getHistoryForVulgos(ids)])
  return { profileSlug: found.profile.slug, vulgos, history }
}

/** Public page of a vulgo, claimed or not: its history and owner (if any). */
export async function getVulgoPage(
  slug: string,
): Promise<{ vulgo: VulgoSummary; history: HistoryEntry[] } | null> {
  const vulgo = await getVulgoBySlug(slug)
  if (!vulgo) return null
  const [summary] = await getVulgoSummaries([vulgo.id])
  if (!summary) return null
  return { vulgo: summary, history: await getHistoryForVulgos([vulgo.id]) }
}
