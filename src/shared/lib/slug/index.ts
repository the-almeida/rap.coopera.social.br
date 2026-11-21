import { ConflictError } from '@/shared/lib/errors/base'
import { err, ok, type Result } from '@/shared/lib/result'

/**
 * URL slugs for public pages (`/leagues/batalha-da-esquina-ficticia`,
 * `/mcs/joao-do-morro`). Names are typed by hosts in any language, so the
 * slug drops diacritics ("João" -> "joao") instead of dropping the letter.
 *
 * Output always satisfies `slugSchema` in `@/shared/lib/validation` or is
 * the empty string (for names with no latin letters/digits at all, e.g.
 * emoji-only); callers must handle that case with a fallback.
 */

export const SLUG_MAX_LENGTH = 64

export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, '')
}

/**
 * Picks `base`, or `base-2`, `base-3`, ... when taken. `taken` is the list of
 * existing slugs that start with `base` (adapters fetch it with one
 * `LIKE 'base%'` query). The DB unique constraint still backs this up: two
 * concurrent creators can pick the same candidate and one of them gets a
 * unique violation.
 */
export function nextAvailableSlug(base: string, taken: readonly string[]): string {
  const used = new Set(taken)
  if (!used.has(base)) return base
  for (let n = 2; ; n++) {
    const suffix = `-${n}`
    const candidate = `${base.slice(0, SLUG_MAX_LENGTH - suffix.length).replace(/-+$/g, '')}${suffix}`
    if (!used.has(candidate)) return candidate
  }
}

/**
 * Slug for a new record:
 *
 * - `requested` (the host typed it): used verbatim, `ConflictError` if taken;
 * - otherwise derived from `name` (falling back to `fallback` when nothing
 *   sluggable is left) and suffixed until free.
 *
 * `findSlugsLike(base)` returns existing slugs equal to `base` or shaped
 * like `base-<n>`.
 */
export async function resolveUniqueSlug(input: {
  requested: string | undefined
  name: string
  fallback: string
  findSlugsLike: (base: string) => Promise<string[]>
}): Promise<Result<string, ConflictError>> {
  if (input.requested) {
    const taken = await input.findSlugsLike(input.requested)
    return taken.includes(input.requested)
      ? err(new ConflictError(`slug "${input.requested}" is already taken`))
      : ok(input.requested)
  }
  const base = slugify(input.name) || input.fallback
  return ok(nextAvailableSlug(base, await input.findSlugsLike(base)))
}
