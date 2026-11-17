import { sql } from 'drizzle-orm'
import { check, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

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

export type UserRow = typeof users.$inferSelect
export type NewUserRow = typeof users.$inferInsert
