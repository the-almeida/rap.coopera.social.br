/**
 * Leagues module — server surface.
 *
 * Battle leagues and their nights (docs/mvp-spec.md): admins create leagues
 * and add organizers; organizers run editions (names, selection with crowd
 * draws, 8/16 brackets, round-by-round crowd votes, withdrawals); every
 * vulgo keeps a public history. Depends on `@/modules/mcs` (vulgos, claims)
 * and `@/modules/auth` (identity); nothing depends on this module.
 *
 * - Server actions: mutations, also exported from `./client.ts`.
 * - Server-only reads: public pages/API (`getLeagueBySlug`,
 *   `listLeagueEditions`, `getEditionDetails`, `getMcPage`, `getVulgoPage`)
 *   and signed-in views (`getMyDashboard`, `listMyLeagues`,
 *   `listLeagueOrganizers`, `listClaimsToReview`, `getCrowdDraws`).
 */

export type { Battle, BattleRound, BattleState } from './domain/bracket'
export type { BracketSize, Edition, EditionStatus, Entry, EntryStatus } from './domain/edition'
export type { EntryOutcome, HistoryBattle, Stage } from './domain/history'
export type { League, LeagueOrganizer } from './domain/league'
export type { LeagueAction } from './domain/policy'
export { leaguePolicy } from './domain/policy'

// Reads
export type { CrowdDrawView } from './features/get-crowd-draws/get-crowd-draws'
export { getCrowdDraws } from './features/get-crowd-draws/get-crowd-draws'
export type { BattleView, EditionDetails } from './features/get-edition/get-edition'
export { getEditionDetails } from './features/get-edition/get-edition'
export type { Paginated, PagingInput } from './features/get-league/get-league'
export { getLeagueBySlug, listLeagueEditions, pagingSchema } from './features/get-league/get-league'
export { getMcPage, getVulgoPage } from './features/get-mc-page/get-mc-page'
export type { MyDashboard } from './features/get-my-dashboard/get-my-dashboard'
export { getMyDashboard } from './features/get-my-dashboard/get-my-dashboard'
export type { ClaimToReview } from './features/list-claims-to-review/list-claims-to-review'
export { listClaimsToReview } from './features/list-claims-to-review/list-claims-to-review'
export { listLeagueOrganizers } from './features/list-league-organizers/list-league-organizers'
export { listMyLeagues } from './features/list-my-leagues/list-my-leagues'
export type { HistoryEntry } from './features/vulgo-history/vulgo-history'

// Admin
export { addLeagueOrganizer } from './features/add-league-organizer/add-league-organizer.handler'
export { createLeague } from './features/create-league/create-league.handler'
export { removeLeagueOrganizer } from './features/remove-league-organizer/remove-league-organizer.handler'

// Battle night
export { addEntry } from './features/add-entry/add-entry.handler'
export { cancelEdition } from './features/cancel-edition/cancel-edition.handler'
export { closeRegistration } from './features/close-registration/close-registration.handler'
export { createEdition } from './features/create-edition/create-edition.handler'
export { moveEntry } from './features/move-entry/move-entry.handler'
export { recordRound } from './features/record-round/record-round.handler'
export { redrawBracket } from './features/redraw-bracket/redraw-bracket.handler'
export { removeEntry } from './features/remove-entry/remove-entry.handler'
export { reopenRegistration } from './features/reopen-registration/reopen-registration.handler'
export { submitCrowdDrawPicks } from './features/submit-crowd-draw-picks/submit-crowd-draw-picks.handler'
export { undoLastRound } from './features/undo-last-round/undo-last-round.handler'
export { withdrawMc } from './features/withdraw-mc/withdraw-mc.handler'

// Vulgo claims
export { decideVulgoClaim } from './features/decide-vulgo-claim/decide-vulgo-claim.handler'
