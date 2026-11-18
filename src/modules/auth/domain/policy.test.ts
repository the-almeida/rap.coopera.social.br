import { describe, expect, it } from 'vitest'

import { UserIdSchema } from '@/shared/lib/ids'

import { accountProtectionPolicy } from './policy'
import type { User } from './user'

function user(email: string, guestNickname: string | null): User {
  return {
    id: UserIdSchema.parse('00000000-0000-4000-8000-000000000001'),
    email,
    name: guestNickname ?? 'Someone',
    guestNickname,
    role: 'user',
    pendingDeletion: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  }
}

describe('accountProtectionPolicy', () => {
  it('lets a guest account add an email', () => {
    expect(
      accountProtectionPolicy(user('wolf@guest.invalid', 'wolf'), { type: 'add-email' }),
    ).toEqual({
      ok: true,
      value: undefined,
    })
  })

  it.each([
    ['an account that started with an email', user('someone@example.test', null)],
    ['a former guest that already added an email', user('wolf@example.test', 'wolf')],
  ])('refuses %s: changing its email is another feature', (_label, account) => {
    expect(accountProtectionPolicy(account, { type: 'add-email' })).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'FORBIDDEN' }),
    })
  })
})
