import { and, eq, sql } from 'drizzle-orm'

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
    role: row.role,
    pendingDeletion,
    emailVerifiedAt: row.emailVerifiedAt,
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
  /**
   * Secures the account on the first proof of its email, in one transaction
   * (public.secure_first_email_proof, see its migration): random password,
   * every session but `keepSessionId` ended, the proof recorded and the
   * account locked for a few seconds against writes already on their way.
   * Proving an old address, or an email already proven, changes nothing.
   * `askForPassword`: the account existed before this sign-in.
   */
  async secureFirstEmailProof(
    id: UserId,
    provenEmail: string,
    keepSessionId: string,
  ): Promise<{ secured: boolean; askForPassword: boolean }> {
    const rows = await db.execute<{ secured: boolean; ask_for_password: boolean }>(sql`
      SELECT secured, ask_for_password
      FROM public.secure_first_email_proof(${id}, ${provenEmail}, ${keepSessionId})
    `)
    return {
      secured: rows[0]?.secured === true,
      askForPassword: rows[0]?.ask_for_password === true,
    }
  },
  /** Whether the account is still locked after the first proof of its email. */
  async isAuthLocked(id: UserId): Promise<boolean> {
    const rows = await db.execute<{ locked: boolean }>(sql`
      SELECT auth_locked_until > clock_timestamp() AS locked FROM public.users WHERE id = ${id}
    `)
    return rows[0]?.locked === true
  },
}
