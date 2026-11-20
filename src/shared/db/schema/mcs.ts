import { sql } from 'drizzle-orm'
import {
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import type { McProfileId, UserId, VulgoClaimId, VulgoId } from '@/shared/lib/ids'

import { users } from './auth'

/**
 * MC identity (docs/mvp-spec.md, "Vulgos and profiles").
 *
 * - Every account is an MC; `mc_profiles` is its 1:1 artist profile.
 * - Battles reference a **vulgo** (stage name), never an account, so
 *   organizers can run a night with names that have no account yet.
 * - A vulgo belongs to at most one profile (`mc_profile_id`, null =
 *   unclaimed). An MC gets an unclaimed vulgo, and its whole history,
 *   through an approved `vulgo_claims` request.
 * - Deleting an account deletes its profile; its vulgos fall back to
 *   unclaimed (SET NULL) and their history stays public.
 */

export const mcProfiles = pgTable('mc_profiles', {
  id: uuid('id').primaryKey().defaultRandom().$type<McProfileId>(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .$type<UserId>()
    .references(() => users.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const vulgos = pgTable(
  'vulgos',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<VulgoId>(),
    name: text('name').notNull(),
    // Accent/case-insensitive identity of the name ("Zé" == "ze"). Unique,
    // so the same vulgo typed by two organizers is one record (duplicate
    // artists with the same vulgo are out of scope for the MVP).
    slug: text('slug').notNull().unique(),
    mcProfileId: uuid('mc_profile_id')
      .$type<McProfileId>()
      .references(() => mcProfiles.id, { onDelete: 'set null' }),
    // Audit: who first typed this name (an organizer, or the MC at sign-up).
    createdBy: uuid('created_by')
      .$type<UserId>()
      .references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('vulgos_name_not_blank', sql`btrim(${table.name}) <> ''`),
    index('vulgos_mc_profile_id_idx').on(table.mcProfileId),
  ],
)

export const vulgoClaimStatus = pgEnum('vulgo_claim_status', ['pending', 'approved', 'rejected'])

export const vulgoClaims = pgTable(
  'vulgo_claims',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<VulgoClaimId>(),
    vulgoId: uuid('vulgo_id')
      .notNull()
      .$type<VulgoId>()
      .references(() => vulgos.id, { onDelete: 'cascade' }),
    mcProfileId: uuid('mc_profile_id')
      .notNull()
      .$type<McProfileId>()
      .references(() => mcProfiles.id, { onDelete: 'cascade' }),
    status: vulgoClaimStatus('status').notNull().default('pending'),
    decidedBy: uuid('decided_by')
      .$type<UserId>()
      .references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One open request per MC per vulgo (several MCs may contest the same one).
    uniqueIndex('vulgo_claims_pending_idx')
      .on(table.vulgoId, table.mcProfileId)
      .where(sql`${table.status} = 'pending'`),
    index('vulgo_claims_mc_profile_id_idx').on(table.mcProfileId),
    check(
      'vulgo_claims_decided_consistency',
      sql`(${table.status} = 'pending') = (${table.decidedAt} IS NULL)`,
    ),
  ],
)

export type McProfileRow = typeof mcProfiles.$inferSelect
export type VulgoRow = typeof vulgos.$inferSelect
export type VulgoClaimRow = typeof vulgoClaims.$inferSelect
