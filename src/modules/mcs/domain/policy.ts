import { ok } from '@/shared/lib/result'

import type { Policy } from '@/modules/auth'

/**
 * MC-side actions. Every account is an MC, so any signed-in user may search
 * vulgos (organizers' autocomplete) and request ownership of an unclaimed
 * vulgo; the claim is scoped to the caller's own profile by the handler.
 *
 * Deciding claims is a league concern (admins, or organizers of a league
 * where the vulgo battled) and lives in the leagues module's policy.
 */
export type McAction = { type: 'search-vulgos' } | { type: 'request-vulgo-claim' }

export const mcPolicy: Policy<McAction> = () => ok(undefined)
