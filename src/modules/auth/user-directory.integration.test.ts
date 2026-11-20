import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { cleanupAuthUser, createTestGuest, createTestUser } from '@/shared/db/test-helpers'
import { UserIdSchema } from '@/shared/lib/ids'

import { AccountLoginSchema } from './domain/login'
import { findUserProfileByLogin, getUserProfiles } from './user-directory'

let secure: Awaited<ReturnType<typeof createTestUser>>
let guest: Awaited<ReturnType<typeof createTestGuest>>

beforeAll(async () => {
  secure = await createTestUser({ prefix: 'directory' })
  guest = await createTestGuest('dir')
})

afterAll(async () => {
  await cleanupAuthUser(secure.id)
  await cleanupAuthUser(guest.id)
})

const login = (raw: string) => AccountLoginSchema.parse(raw)

describe('findUserProfileByLogin', () => {
  it('finds a secure account by its email, ignoring case', async () => {
    expect(await findUserProfileByLogin(login(secure.email.toUpperCase()))).toEqual({
      id: secure.id,
      name: secure.name,
      email: secure.email,
    })
  })

  it('finds a guest account by its nickname and hides the guest address', async () => {
    expect(await findUserProfileByLogin(login(guest.nickname))).toEqual({
      id: guest.id,
      name: guest.nickname,
      email: null,
    })
  })

  it('returns null when no account matches', async () => {
    expect(await findUserProfileByLogin(login(`nobody-${randomUUID()}@x.test`))).toBeNull()
    expect(await findUserProfileByLogin(login('nobody_at_all_here'))).toBeNull()
  })
})

describe('getUserProfiles', () => {
  it('returns each existing account once, guests without their address', async () => {
    const profiles = await getUserProfiles([
      secure.id,
      guest.id,
      secure.id,
      UserIdSchema.parse(randomUUID()),
    ])

    expect(profiles).toHaveLength(2)
    expect(profiles).toEqual(
      expect.arrayContaining([
        { id: secure.id, name: secure.name, email: secure.email },
        { id: guest.id, name: guest.nickname, email: null },
      ]),
    )
  })
})
