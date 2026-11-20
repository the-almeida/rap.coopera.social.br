import { NextResponse } from 'next/server'

import { rateLimit } from '@/shared/lib/rate-limit'

import { extractIpFromHeaders } from './request-ip'

/**
 * Helpers for the public, read-only JSON API (`src/app/api/...`): league
 * history, brackets and careers that fan sites and stream overlays poll.
 * Unauthenticated, so every route is per-IP rate-limited and answers with
 * CDN-cacheable responses.
 */

/** Overlays poll live brackets; 120/min per IP covers one poll every 0.5 s. */
const PUBLIC_READ_LIMIT = { windowMs: 60_000, max: 120 }

export async function limitPublicRead(
  request: Request,
  bucket: string,
): Promise<NextResponse | null> {
  const ip = extractIpFromHeaders(request.headers)
  const limit = await rateLimit(`public-api:${bucket}:ip:${ip}`, PUBLIC_READ_LIMIT)
  return limit.ok ? null : jsonError(429, 'too_many_requests')
}

/**
 * `maxAgeSeconds` is the CDN TTL. Keep it short for live data (brackets
 * change on every result) and longer for history.
 */
export function jsonOk(body: unknown, maxAgeSeconds: number): NextResponse {
  return NextResponse.json(body, {
    headers: {
      'cache-control': `public, s-maxage=${maxAgeSeconds}, stale-while-revalidate=${maxAgeSeconds * 5}`,
    },
  })
}

export function jsonError(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status, headers: { 'cache-control': 'no-store' } })
}
