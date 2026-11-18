import { eq, sql } from 'drizzle-orm'

import { db } from '@/shared/db/client'
import { guestEmailVerifications } from '@/shared/db/schema/auth'
import type { UserId } from '@/shared/lib/ids'

// No port in front: one implementation, tested against the local database
// (ADR-0007).
export const guestEmailVerificationRepository = {
  /** Stores the pending code for this account, replacing any earlier one. */
  async upsert(input: { userId: UserId; email: string; codeHash: string; expiresAt: Date }) {
    await db
      .insert(guestEmailVerifications)
      .values({ ...input, attempts: 0 })
      .onConflictDoUpdate({
        target: guestEmailVerifications.userId,
        set: {
          email: input.email,
          codeHash: input.codeHash,
          expiresAt: input.expiresAt,
          attempts: 0,
          createdAt: new Date(),
        },
      })
  },
  async find(userId: UserId) {
    const [row] = await db
      .select()
      .from(guestEmailVerifications)
      .where(eq(guestEmailVerifications.userId, userId))
      .limit(1)
    return row ?? null
  },
  /**
   * Counts one more try, in the database, so tries that arrive together are
   * counted one by one. Null when nothing is pending.
   */
  async incrementAttempts(userId: UserId): Promise<number | null> {
    const [row] = await db
      .update(guestEmailVerifications)
      .set({ attempts: sql`${guestEmailVerifications.attempts} + 1` })
      .where(eq(guestEmailVerifications.userId, userId))
      .returning({ attempts: guestEmailVerifications.attempts })
    return row?.attempts ?? null
  },
  async delete(userId: UserId) {
    await db.delete(guestEmailVerifications).where(eq(guestEmailVerifications.userId, userId))
  },
}
