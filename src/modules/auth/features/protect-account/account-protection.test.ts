import { describe, expect, it } from 'vitest'

import { resolveAccountProtection } from './account-protection'

describe('resolveAccountProtection', () => {
  it('leaves an account that started with an email alone', () => {
    expect(
      resolveAccountProtection({ email: 'someone@example.test', guestNickname: null }, []),
    ).toEqual({
      needsProtection: false,
      nickname: null,
    })
  })

  it('asks a new guest account to protect itself', () => {
    expect(
      resolveAccountProtection({ email: 'wolf@guest.invalid', guestNickname: 'wolf' }, ['email']),
    ).toEqual({
      needsProtection: true,
      nickname: 'wolf',
    })
  })

  it.each(['google', 'facebook'])('stops asking once %s is linked', (provider) => {
    expect(
      resolveAccountProtection({ email: 'wolf@guest.invalid', guestNickname: 'wolf' }, [
        'email',
        provider,
      ]),
    ).toMatchObject({ needsProtection: false })
  })

  it('keeps asking when the sign-in methods could not be read', () => {
    expect(
      resolveAccountProtection({ email: 'wolf@guest.invalid', guestNickname: 'wolf' }, []),
    ).toMatchObject({
      needsProtection: true,
    })
  })

  it('stops asking once the guest added a real email', () => {
    expect(
      resolveAccountProtection({ email: 'wolf@example.test', guestNickname: 'wolf' }, ['email']),
    ).toEqual({
      needsProtection: false,
      nickname: 'wolf',
    })
  })
})
