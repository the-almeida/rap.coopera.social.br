import { eq } from 'drizzle-orm'

import { db } from '@/shared/db/client'
import { users, type UserRow } from '@/shared/db/schema/auth'
import { exampleEntities } from '@/shared/db/schema/example-entity'
import { cleanupAuthUser, createTestUser } from '@/shared/db/test-helpers'
import { UserIdSchema, type ExampleEntityId } from '@/shared/lib/ids'

import type { User } from '@/modules/auth'

// Built from the stored row, so what the policy sees is what is in the DB.
function userFromRow(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    guestNickname: row.guestNickname,
    role: row.role,
    pendingDeletion: null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function storedUser(id: string): Promise<User> {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.id, UserIdSchema.parse(id)))
  if (!row) throw new Error('auth trigger did not create the public.users row')
  return userFromRow(row)
}

/**
 * Integration-test fixtures for the example module: real users (through
 * the auth trigger) and real rows. Call `cleanup()` in afterEach; deleting
 * the users cascades to their entities.
 */
export function exampleFixtures() {
  const userIds: string[] = []

  return {
    async user(role: 'user' | 'admin' = 'user'): Promise<User> {
      const seeded = await createTestUser({ prefix: 'example', role })
      userIds.push(seeded.id)
      return storedUser(seeded.id)
    },
    async row(id: ExampleEntityId) {
      const [row] = await db.select().from(exampleEntities).where(eq(exampleEntities.id, id))
      return row ?? null
    },
    async count(owner: User) {
      return (await db.select().from(exampleEntities).where(eq(exampleEntities.userId, owner.id)))
        .length
    },
    async cleanup() {
      for (const id of userIds.splice(0)) await cleanupAuthUser(id)
    },
  }
}
