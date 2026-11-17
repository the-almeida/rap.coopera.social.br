import { and, eq } from 'drizzle-orm'

import { db } from '@/shared/db/client'
import { accountDeletionRequests, activeDeletionRequest } from '@/shared/db/schema/account-deletion'
import { users } from '@/shared/db/schema/auth'
import type { UserId } from '@/shared/lib/ids'

import type { User } from '../domain/user'

function rowToUser(row: typeof users.$inferSelect, pendingDeletion: User['pendingDeletion']): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    guestNickname: row.guestNickname,
    role: row.role,
    pendingDeletion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

// No port in front: one implementation, tested against the local database
// (ADR-0007). Rows are created by the auth trigger, not by the app.
export const userRepository = {
  // One query for the user and their account state. The active-request
  // condition must stay in the join (ON), not in WHERE: in WHERE, a user
  // whose requests were all cancelled would not be found at all.
  async findById(id: UserId) {
    const [row] = await db
      .select({ user: users, scheduledFor: accountDeletionRequests.scheduledFor })
      .from(users)
      .leftJoin(
        accountDeletionRequests,
        and(eq(accountDeletionRequests.userId, users.id), activeDeletionRequest()),
      )
      .where(eq(users.id, id))
      .limit(1)
    if (!row) return null
    return rowToUser(row.user, row.scheduledFor ? { scheduledFor: row.scheduledFor } : null)
  },
  /** The account a guest nickname is reserved for, by its current email. */
  async findByGuestNickname(nickname: string): Promise<{ id: UserId; email: string } | null> {
    const [row] = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.guestNickname, nickname))
      .limit(1)
    return row ?? null
  },
  /**
   * Finishes a new guest account in one write: reserves its nickname and
   * trusts its password (creating the account is the only proof a guest
   * address can have, see domain/guest.ts).
   */
  async completeGuestSetup(id: UserId, nickname: string): Promise<void> {
    const now = new Date()
    await db
      .update(users)
      .set({ guestNickname: nickname, passwordVerifiedAt: now, updatedAt: now })
      .where(eq(users.id, id))
  },
  /** Records that the password was proven together with the mailbox. */
  async markPasswordVerified(id: UserId): Promise<void> {
    await db
      .update(users)
      .set({ passwordVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, id))
  },
}
