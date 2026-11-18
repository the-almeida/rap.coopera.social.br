import { randomUUID } from 'node:crypto'

import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { db } from '@/shared/db/client'
import {
  cleanupAuthUser,
  createTestGuest,
  createTestUser,
  uniqueTestEmail,
} from '@/shared/db/test-helpers'

// Manual identity linking is on for the whole project (guests link Google or
// Facebook to protect themselves), so the database decides which links are
// allowed. Identities are inserted with SQL, as Supabase Auth does when it
// links one: a real provider cannot run locally.

const createdUserIds: string[] = []
afterEach(async () => {
  for (const id of createdUserIds.splice(0)) await cleanupAuthUser(id)
})

async function link(userId: string, provider: string, email: string) {
  await db.execute(sql`
    INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
    VALUES (${randomUUID()}, ${userId}, ${JSON.stringify({ sub: randomUUID(), email })}::jsonb, ${provider}, now(), now())
  `)
}

describe('linking a sign-in provider', () => {
  it('refuses a provider account with another email on an account that is not a guest', async () => {
    // A stolen session could otherwise plant the thief's own Google sign-in.
    const owner = await createTestUser({ prefix: 'link-other' })
    createdUserIds.push(owner.id)

    await expect(link(owner.id, 'google', uniqueTestEmail('thief'))).rejects.toThrow(
      expect.objectContaining({ cause: expect.objectContaining({ code: '23514' }) }),
    )
  })

  it('lets an account link a provider account with its own email, as Supabase does on sign-in', async () => {
    const owner = await createTestUser({ prefix: 'link-same' })
    createdUserIds.push(owner.id)

    await expect(link(owner.id, 'google', owner.email.toUpperCase())).resolves.not.toThrow()
  })

  it('lets a guest account link any provider account: that is how it protects itself', async () => {
    const guest = await createTestGuest('link-guest')
    createdUserIds.push(guest.id)

    await expect(link(guest.id, 'facebook', uniqueTestEmail('guest-own'))).resolves.not.toThrow()
  })
})
