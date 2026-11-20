import { sql } from 'drizzle-orm'
import { check, index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import type { LeagueId, UserId } from '@/shared/lib/ids'

import { users } from './auth'

/**
 * Leagues are created by platform admins, who add organizers to them.
 * All organizers of a league are equals (no owner role). See
 * docs/mvp-spec.md, "Roles".
 */
export const leagues = pgTable(
  'leagues',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<LeagueId>(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    createdBy: uuid('created_by')
      .$type<UserId>()
      .references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('leagues_name_not_blank', sql`btrim(${table.name}) <> ''`)],
)

export const leagueOrganizers = pgTable(
  'league_organizers',
  {
    leagueId: uuid('league_id')
      .notNull()
      .$type<LeagueId>()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .$type<UserId>()
      .references(() => users.id, { onDelete: 'cascade' }),
    addedBy: uuid('added_by')
      .$type<UserId>()
      .references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.leagueId, table.userId] }),
    index('league_organizers_user_id_idx').on(table.userId),
  ],
)

export type LeagueRow = typeof leagues.$inferSelect
export type LeagueOrganizerRow = typeof leagueOrganizers.$inferSelect
