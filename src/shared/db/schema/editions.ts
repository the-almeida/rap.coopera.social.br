import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

import type {
  BattleId,
  BattleRoundId,
  CrowdDrawId,
  EditionId,
  EntryId,
  LeagueId,
  UserId,
  VulgoId,
  WithdrawalId,
} from '@/shared/lib/ids'

import { users } from './auth'
import { leagues } from './leagues'
import { vulgos } from './mcs'

/**
 * One battle night of a league (docs/mvp-spec.md, "Battle night").
 *
 *   registration ──close list──▶ selection ──picks entered / bracket drawn──▶ in_progress
 *        │                          │                                            │
 *        └──────────────────────────┴──────────── cancelled ◀────────────────────┤
 *                                                                    final decided ▼
 *                                                                           completed
 *
 * Integrity: every child table carries `edition_id` and references entries,
 * draws and battles through composite (edition_id, id) foreign keys, so the
 * database guarantees nothing can point at another edition's rows.
 * Composite FKs use NO ACTION (not RESTRICT) so deleting an edition can
 * cascade through all of them in one statement.
 */

export const editionStatus = pgEnum('edition_status', [
  'registration',
  'selection',
  'in_progress',
  'completed',
  'cancelled',
])

export const editions = pgTable(
  'editions',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<EditionId>(),
    leagueId: uuid('league_id')
      .notNull()
      .$type<LeagueId>()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    eventDate: date('event_date', { mode: 'string' }).notNull(),
    status: editionStatus('status').notNull().default('registration'),
    // Fixed when the list is closed: 8 or 16 (see the selection table).
    bracketSize: integer('bracket_size'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('editions_league_number_unique').on(table.leagueId, table.number),
    index('editions_league_event_date_idx').on(table.leagueId, table.eventDate),
    check('editions_number_positive', sql`${table.number} > 0`),
    check(
      'editions_bracket_size_valid',
      sql`${table.bracketSize} IS NULL OR ${table.bracketSize} IN (8, 16)`,
    ),
    check(
      'editions_bracket_size_after_registration',
      sql`${table.status} IN ('registration', 'cancelled') OR ${table.bracketSize} IS NOT NULL`,
    ),
  ],
)

export const entryStatus = pgEnum('entry_status', [
  'registered',
  'selected',
  'not_selected',
  'withdrew',
])

export const entrySelection = pgEnum('entry_selection', ['arrival', 'draw', 'replacement'])

/**
 * The night's list of names. `number` is the arrival position (1, 2, 3...).
 * It is unique per edition through a DEFERRABLE constraint added by the
 * hand-written migration `..._edition_entries_number_deferrable.sql`
 * (Drizzle cannot declare deferrable constraints), so reordering the list
 * can permute numbers in a single UPDATE.
 */
export const editionEntries = pgTable(
  'edition_entries',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<EntryId>(),
    editionId: uuid('edition_id')
      .notNull()
      .$type<EditionId>()
      .references(() => editions.id, { onDelete: 'cascade' }),
    // No ON DELETE: a vulgo with battle history cannot be deleted.
    vulgoId: uuid('vulgo_id')
      .notNull()
      .$type<VulgoId>()
      .references(() => vulgos.id),
    number: integer('number').notNull(),
    status: entryStatus('status').notNull().default('registered'),
    selectedBy: entrySelection('selected_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('edition_entries_edition_vulgo_unique').on(table.editionId, table.vulgoId),
    unique('edition_entries_edition_id_unique').on(table.editionId, table.id),
    index('edition_entries_vulgo_id_idx').on(table.vulgoId),
    check('edition_entries_number_positive', sql`${table.number} > 0`),
    check(
      'edition_entries_selected_by_consistency',
      sql`(${table.selectedBy} IS NOT NULL) = (${table.status} IN ('selected', 'withdrew'))`,
    ),
  ],
)

export const crowdDrawReason = pgEnum('crowd_draw_reason', ['selection', 'replacement'])

/**
 * A crowd draw: the MCs still in the pool get random numbers 1..X, the crowd
 * calls out `slots` numbers, the organizer enters them. Organizers/admins
 * only; never exposed publicly (see the RLS migration).
 */
export const crowdDraws = pgTable(
  'crowd_draws',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<CrowdDrawId>(),
    editionId: uuid('edition_id')
      .notNull()
      .$type<EditionId>()
      .references(() => editions.id, { onDelete: 'cascade' }),
    reason: crowdDrawReason('reason').notNull(),
    slots: integer('slots').notNull(),
    createdBy: uuid('created_by')
      .$type<UserId>()
      .references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Set when the organizer enters the crowd's picks.
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    unique('crowd_draws_edition_id_unique').on(table.editionId, table.id),
    check('crowd_draws_slots_positive', sql`${table.slots} > 0`),
  ],
)

export const crowdDrawTickets = pgTable(
  'crowd_draw_tickets',
  {
    editionId: uuid('edition_id').notNull().$type<EditionId>(),
    drawId: uuid('draw_id').notNull().$type<CrowdDrawId>(),
    entryId: uuid('entry_id').notNull().$type<EntryId>(),
    number: integer('number').notNull(),
    picked: boolean('picked').notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.drawId, table.entryId] }),
    unique('crowd_draw_tickets_draw_number_unique').on(table.drawId, table.number),
    foreignKey({
      name: 'crowd_draw_tickets_draw_fk',
      columns: [table.editionId, table.drawId],
      foreignColumns: [crowdDraws.editionId, crowdDraws.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'crowd_draw_tickets_entry_fk',
      columns: [table.editionId, table.entryId],
      foreignColumns: [editionEntries.editionId, editionEntries.id],
    }),
    check('crowd_draw_tickets_number_positive', sql`${table.number} > 0`),
  ],
)

/**
 * Single-elimination bracket (8 or 16). All battles are created when the
 * bracket is drawn; later phases start empty. The winner of (phase p,
 * position n) goes to (phase p + 1, position ceil(n / 2)): slot A when n is
 * odd, B when even. `winner_entry_id` is derived from the rounds (first to
 * two) or set directly by a walkover.
 */
export const battles = pgTable(
  'battles',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<BattleId>(),
    editionId: uuid('edition_id')
      .notNull()
      .$type<EditionId>()
      .references(() => editions.id, { onDelete: 'cascade' }),
    phase: integer('phase').notNull(),
    position: integer('position').notNull(),
    entryAId: uuid('entry_a_id').$type<EntryId>(),
    entryBId: uuid('entry_b_id').$type<EntryId>(),
    winnerEntryId: uuid('winner_entry_id').$type<EntryId>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('battles_edition_phase_position_unique').on(
      table.editionId,
      table.phase,
      table.position,
    ),
    unique('battles_edition_id_unique').on(table.editionId, table.id),
    foreignKey({
      name: 'battles_entry_a_fk',
      columns: [table.editionId, table.entryAId],
      foreignColumns: [editionEntries.editionId, editionEntries.id],
    }),
    foreignKey({
      name: 'battles_entry_b_fk',
      columns: [table.editionId, table.entryBId],
      foreignColumns: [editionEntries.editionId, editionEntries.id],
    }),
    index('battles_entry_a_id_idx').on(table.entryAId),
    index('battles_entry_b_id_idx').on(table.entryBId),
    check('battles_phase_positive', sql`${table.phase} > 0`),
    check('battles_position_positive', sql`${table.position} > 0`),
    check(
      'battles_distinct_entries',
      sql`${table.entryAId} IS NULL OR ${table.entryBId} IS NULL OR ${table.entryAId} <> ${table.entryBId}`,
    ),
    check(
      'battles_winner_in_battle',
      sql`${table.winnerEntryId} IS NULL OR ${table.winnerEntryId} = ${table.entryAId} OR ${table.winnerEntryId} = ${table.entryBId}`,
    ),
  ],
)

/**
 * One round of a battle with the crowd's votes. Ties are impossible by rule
 * (the organizer casts the tiebreaker vote), so tied counts are rejected.
 */
export const battleRounds = pgTable(
  'battle_rounds',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<BattleRoundId>(),
    battleId: uuid('battle_id')
      .notNull()
      .$type<BattleId>()
      .references(() => battles.id, { onDelete: 'cascade' }),
    roundNo: integer('round_no').notNull(),
    votesA: integer('votes_a').notNull(),
    votesB: integer('votes_b').notNull(),
    recordedBy: uuid('recorded_by')
      .$type<UserId>()
      .references(() => users.id, { onDelete: 'set null' }),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('battle_rounds_battle_round_unique').on(table.battleId, table.roundNo),
    check('battle_rounds_round_no_range', sql`${table.roundNo} BETWEEN 1 AND 3`),
    check('battle_rounds_votes_non_negative', sql`${table.votesA} >= 0 AND ${table.votesB} >= 0`),
    check('battle_rounds_no_tie', sql`${table.votesA} <> ${table.votesB}`),
  ],
)

export const withdrawalMethod = pgEnum('withdrawal_method', [
  'crowd_draw',
  'previous_opponent',
  'walkover',
])

/**
 * A selected MC leaving (exceptional). See docs/mvp-spec.md, "Withdrawals":
 * - crowd_draw: before their first battle; `crowd_draw_id` points at the
 *   replacement draw, `replacement_entry_id` is set once the crowd picks;
 * - previous_opponent: the MC they beat most recently takes their place;
 * - walkover: nobody can replace them; the opponent advances.
 */
export const withdrawals = pgTable(
  'withdrawals',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<WithdrawalId>(),
    editionId: uuid('edition_id')
      .notNull()
      .$type<EditionId>()
      .references(() => editions.id, { onDelete: 'cascade' }),
    entryId: uuid('entry_id').notNull().unique().$type<EntryId>(),
    battleId: uuid('battle_id').notNull().$type<BattleId>(),
    replacementEntryId: uuid('replacement_entry_id').$type<EntryId>(),
    method: withdrawalMethod('method').notNull(),
    crowdDrawId: uuid('crowd_draw_id').$type<CrowdDrawId>(),
    recordedBy: uuid('recorded_by')
      .$type<UserId>()
      .references(() => users.id, { onDelete: 'set null' }),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'withdrawals_entry_fk',
      columns: [table.editionId, table.entryId],
      foreignColumns: [editionEntries.editionId, editionEntries.id],
    }),
    foreignKey({
      name: 'withdrawals_battle_fk',
      columns: [table.editionId, table.battleId],
      foreignColumns: [battles.editionId, battles.id],
    }),
    foreignKey({
      name: 'withdrawals_replacement_entry_fk',
      columns: [table.editionId, table.replacementEntryId],
      foreignColumns: [editionEntries.editionId, editionEntries.id],
    }),
    foreignKey({
      name: 'withdrawals_crowd_draw_fk',
      columns: [table.editionId, table.crowdDrawId],
      foreignColumns: [crowdDraws.editionId, crowdDraws.id],
    }),
    check(
      'withdrawals_replacement_differs',
      sql`${table.replacementEntryId} IS NULL OR ${table.replacementEntryId} <> ${table.entryId}`,
    ),
    check(
      'withdrawals_method_consistency',
      sql`CASE ${table.method}
        WHEN 'walkover' THEN ${table.replacementEntryId} IS NULL AND ${table.crowdDrawId} IS NULL
        WHEN 'previous_opponent' THEN ${table.replacementEntryId} IS NOT NULL AND ${table.crowdDrawId} IS NULL
        WHEN 'crowd_draw' THEN ${table.crowdDrawId} IS NOT NULL
      END`,
    ),
  ],
)

export type EditionRow = typeof editions.$inferSelect
export type EditionEntryRow = typeof editionEntries.$inferSelect
export type CrowdDrawRow = typeof crowdDraws.$inferSelect
export type CrowdDrawTicketRow = typeof crowdDrawTickets.$inferSelect
export type BattleRow = typeof battles.$inferSelect
export type BattleRoundRow = typeof battleRounds.$inferSelect
export type WithdrawalRow = typeof withdrawals.$inferSelect
