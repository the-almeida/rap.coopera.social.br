import { randomUUID } from 'node:crypto'

import { inArray } from 'drizzle-orm'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import { db } from '@/shared/db/client'
import { vulgos } from '@/shared/db/schema'
import { cleanupAuthUser, getAdminSupabase, uniqueTestEmail } from '@/shared/db/test-helpers'
import { UnauthenticatedError } from '@/shared/lib/errors/base'
import { UserIdSchema } from '@/shared/lib/ids'
import { err, ok } from '@/shared/lib/result'

import type * as AuthModule from '@/modules/auth'
import type { User } from '@/modules/auth'

import { ensureMcProfile, findOrCreateVulgo, getMyMcIdentity, searchVulgos } from './index'

let caller: User | null = null
vi.mock('@/modules/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  requireUser: async () => (caller ? ok(caller) : err(new UnauthenticatedError())),
}))

type AnyResult = { ok: true; value: unknown } | { ok: false; error: { code: string } }
function unwrap<R extends AnyResult>(result: R): Extract<R, { ok: true }>['value'] {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value as Extract<R, { ok: true }>['value']
}

const run = randomUUID().slice(0, 8)
const users: User[] = []

async function account(name: string): Promise<User> {
  const email = uniqueTestEmail('mcs')
  const { data } = await getAdminSupabase().auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { name },
  })
  const user: User = {
    id: UserIdSchema.parse(data.user!.id),
    email,
    name,
    guestNickname: null,
    role: 'user',
    pendingDeletion: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  users.push(user)
  return user
}

afterEach(() => {
  caller = null
})

afterAll(async () => {
  await db.delete(vulgos).where(
    inArray(
      vulgos.createdBy,
      users.map((u) => u.id),
    ),
  )
  for (const user of users) await cleanupAuthUser(user.id)
})

describe('mcs identity', () => {
  it('treats accent/case/spacing variants typed by organizers as one vulgo', async () => {
    const organizer = await account(`Organizer ${run}`)
    const first = unwrap(
      await findOrCreateVulgo({ name: `Zé  Exemplo ${run}`, createdBy: organizer.id }),
    )
    const again = unwrap(
      await findOrCreateVulgo({ name: `ZE EXEMPLO ${run}`, createdBy: organizer.id }),
    )
    expect(again.id).toBe(first.id)
    expect(first.name).toBe(`Zé Exemplo ${run}`)
    expect(first.mcProfileId).toBeNull()
    expect((await findOrCreateVulgo({ name: '🔥🎤', createdBy: organizer.id })).ok).toBe(false)
  })

  it('never hands a vulgo owned by another MC to a new sign-up', async () => {
    const name = `Dona Vulgo ${run}`
    const owner = await account(name)
    expect((await getMyMcIdentity(owner)).vulgos.map((v) => v.name)).toEqual([name])

    const namesake = await account(name)
    const identity = await getMyMcIdentity(namesake)
    expect(identity.vulgos).toHaveLength(0)
    expect(identity.claims).toHaveLength(0)
  })

  it('creates a profile even when the name has nothing to make a vulgo from', async () => {
    const emoji = await account('🔥🎤')
    const profile = await ensureMcProfile(emoji)
    expect(profile.slug).toMatch(/^mc(-\d+)?$/)
    expect((await getMyMcIdentity(emoji)).vulgos).toHaveLength(0)
    expect((await ensureMcProfile(emoji)).id).toBe(profile.id)
  })

  it('searches without accents and treats wildcards literally', async () => {
    caller = await account(`Searcher ${run}`)
    unwrap(await findOrCreateVulgo({ name: `Negão Flow ${run}`, createdBy: caller.id }))
    const found = unwrap(await searchVulgos({ query: `negao flow ${run}` }))
    expect(found.map((v) => v.name)).toEqual([`Negão Flow ${run}`])
    expect(unwrap(await searchVulgos({ query: '%_%' }))).toEqual([])
    caller = null
    expect((await searchVulgos({ query: 'x' })).ok).toBe(false)
  })
})
