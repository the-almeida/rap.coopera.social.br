/**
 * MCs module — server surface.
 *
 * MC identity (docs/mvp-spec.md, "Vulgos and profiles"): one profile per
 * account, vulgos (stage names) that battles point at, and claims through
 * which an MC takes ownership of an unclaimed vulgo and its history.
 *
 * Knows nothing about leagues or editions. The leagues module depends on
 * this one (never the reverse); deciding claims is authorized there,
 * because only organizers of a league where the vulgo battled may decide.
 */

export type {
  McProfile,
  Vulgo,
  VulgoClaim,
  VulgoClaimDecision,
  VulgoClaimStatus,
  VulgoSummary,
} from './domain/mc'
export type { McAction } from './domain/policy'
export { mcPolicy } from './domain/policy'

// Server-side functions (not server actions).
export { ensureMcProfile } from './features/ensure-mc-profile/ensure-mc-profile'
export type { MyMcIdentity, PendingVulgoClaim } from './features/vulgo-directory/vulgo-directory'
export {
  applyVulgoClaimDecision,
  findOrCreateVulgo,
  getMcProfileBySlug,
  getMyMcIdentity,
  getVulgoById,
  getVulgoBySlug,
  getVulgoClaim,
  getVulgoSummaries,
  listPendingVulgoClaims,
  VULGO_NAME_MAX_LENGTH,
} from './features/vulgo-directory/vulgo-directory'

// Server actions.
export { requestVulgoClaim } from './features/request-vulgo-claim/request-vulgo-claim.handler'
export { searchVulgos } from './features/search-vulgos/search-vulgos.handler'
