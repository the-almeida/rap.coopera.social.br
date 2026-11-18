import { sql } from 'drizzle-orm'
import { check, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import type { UserId } from '@/shared/lib/ids'

export const userRole = pgEnum('user_role', ['user', 'admin'])

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().$type<UserId>(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    role: userRole('role').notNull().default('user'),
    // When the person proved, in one go, the password and the mailbox (an
    // emailed code). Null: never proven, so Supabase Auth refuses
    // password-only sessions (public.custom_access_token_hook).
    passwordVerifiedAt: timestamp('password_verified_at', { withTimezone: true }),
    // A guest account's nickname: how it signs in, reserved for the account's
    // whole life (it keeps working after an email is added). Null for
    // accounts that started with an email.
    guestNickname: text('guest_nickname').unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('users_name_not_blank', sql`btrim(${table.name}) <> ''`)],
)

// The pending code that adds an email to a guest account: one per account,
// stored hashed, with its expiry and how many tries it has had. Only the app
// reads it (RLS on, no API grants).
export const guestEmailVerifications = pgTable('guest_email_verifications', {
  userId: uuid('user_id')
    .primaryKey()
    .$type<UserId>()
    .references(() => users.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  codeHash: text('code_hash').notNull(),
  attempts: integer('attempts').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type UserRow = typeof users.$inferSelect
export type NewUserRow = typeof users.$inferInsert
