/**
 * Leagues module — client-facing surface: server actions, their input types
 * and domain types. No server-only reads. See `@/modules/auth/client` for
 * why the split exists.
 */

export type { Battle, BattleRound, BattleState } from './domain/bracket'
export type { BracketSize, Edition, EditionStatus, Entry, EntryStatus } from './domain/edition'
export type { EntryOutcome, Stage } from './domain/history'
export type { League, LeagueOrganizer } from './domain/league'

export type { AddEntryInput } from './features/add-entry/add-entry.schema'
export type { AddLeagueOrganizerInput } from './features/add-league-organizer/add-league-organizer.schema'
export type { EditionRefInput } from './features/cancel-edition/cancel-edition.schema'
export type { CreateEditionInput } from './features/create-edition/create-edition.schema'
export type { CreateLeagueInput } from './features/create-league/create-league.schema'
export type { DecideVulgoClaimInput } from './features/decide-vulgo-claim/decide-vulgo-claim.schema'
export type { MoveEntryInput } from './features/move-entry/move-entry.schema'
export type { RecordRoundInput } from './features/record-round/record-round.schema'
export type { EntryRefInput } from './features/remove-entry/remove-entry.schema'
export type { RemoveLeagueOrganizerInput } from './features/remove-league-organizer/remove-league-organizer.schema'
export type { SubmitCrowdDrawPicksInput } from './features/submit-crowd-draw-picks/submit-crowd-draw-picks.schema'
export type { BattleRefInput } from './features/undo-last-round/undo-last-round.schema'

export { addEntry } from './features/add-entry/add-entry.handler'
export { addLeagueOrganizer } from './features/add-league-organizer/add-league-organizer.handler'
export { cancelEdition } from './features/cancel-edition/cancel-edition.handler'
export { closeRegistration } from './features/close-registration/close-registration.handler'
export { createEdition } from './features/create-edition/create-edition.handler'
export { createLeague } from './features/create-league/create-league.handler'
export { decideVulgoClaim } from './features/decide-vulgo-claim/decide-vulgo-claim.handler'
export { moveEntry } from './features/move-entry/move-entry.handler'
export { recordRound } from './features/record-round/record-round.handler'
export { redrawBracket } from './features/redraw-bracket/redraw-bracket.handler'
export { removeEntry } from './features/remove-entry/remove-entry.handler'
export { removeLeagueOrganizer } from './features/remove-league-organizer/remove-league-organizer.handler'
export { reopenRegistration } from './features/reopen-registration/reopen-registration.handler'
export { submitCrowdDrawPicks } from './features/submit-crowd-draw-picks/submit-crowd-draw-picks.handler'
export { undoLastRound } from './features/undo-last-round/undo-last-round.handler'
export { withdrawMc } from './features/withdraw-mc/withdraw-mc.handler'
