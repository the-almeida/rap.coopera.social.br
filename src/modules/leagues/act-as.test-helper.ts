import { createTestGuest, getAdminSupabase, uniqueTestEmail } from '@/shared/db/test-helpers'
import { UnauthenticatedError } from '@/shared/lib/errors/base'
import { UserIdSchema } from '@/shared/lib/ids'
import { err, ok } from '@/shared/lib/result'

import type { User } from '@/modules/auth'

/**
 * Integration tests drive the real server actions (validation, policy,
 * locking, error serialization). The one thing they cannot do is carry a
 * Supabase session cookie, so test files mock `requireUser` with
 * `requireUserMock` and pick the caller with `actAs(user)`:
 *
 *   vi.mock('@/modules/auth', async (importOriginal) => ({
 *     ...(await importOriginal<typeof AuthModule>()),
 *     requireUser: () => requireUserMock(),
 *   }))
 */

let currentUser: User | null = null

export function requireUserMock() {
  return Promise.resolve(
    currentUser ? ok(currentUser) : err(new UnauthenticatedError('not authenticated')),
  )
}

export function actAs(user: User | null): void {
  currentUser = user
}

/** A real account (auth.users + public.users via the sync trigger). */
export async function createAccount(name: string, role: User['role'] = 'user'): Promise<User> {
  const email = uniqueTestEmail('battle')
  const { data, error } = await getAdminSupabase().auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { name },
  })
  if (error || !data.user) throw new Error(`createAccount failed: ${error?.message}`)
  // `role` only matters to the policies, which read it from the User object.
  return {
    id: UserIdSchema.parse(data.user.id),
    email,
    name,
    guestNickname: null,
    role,
    pendingDeletion: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

/** A real guest account (nickname and password, no email), as the app creates it. */
export async function createGuestAccount(prefix: string): Promise<User> {
  const guest = await createTestGuest(prefix)
  return {
    id: guest.id,
    email: guest.email,
    name: guest.nickname,
    guestNickname: guest.nickname,
    role: 'user',
    pendingDeletion: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}
