/**
 * MCs module — client-facing surface: server actions, their input types and
 * domain types. See `@/modules/auth/client` for why the split exists.
 */

export type { McProfile, Vulgo, VulgoClaim, VulgoClaimStatus, VulgoSummary } from './domain/mc'
export type { RequestVulgoClaimInput } from './features/request-vulgo-claim/request-vulgo-claim.schema'
export type { SearchVulgosInput } from './features/search-vulgos/search-vulgos.schema'

export { requestVulgoClaim } from './features/request-vulgo-claim/request-vulgo-claim.handler'
export { searchVulgos } from './features/search-vulgos/search-vulgos.handler'
