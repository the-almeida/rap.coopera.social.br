import { describe, expect, it } from 'vitest'

import { parseAuthMethod, resolveAuthMethod } from './auth-method'

describe('resolveAuthMethod', () => {
  it('shows the chooser on a first visit', () => {
    expect(resolveAuthMethod({ param: undefined, remembered: undefined, error: undefined })).toBe(
      null,
    )
  })

  it('uses the remembered choice when the URL has no step', () => {
    expect(resolveAuthMethod({ param: undefined, remembered: 'guest', error: undefined })).toBe(
      'guest',
    )
  })

  it('lets a step in the URL win over the remembered choice', () => {
    expect(resolveAuthMethod({ param: 'account', remembered: 'guest', error: undefined })).toBe(
      'account',
    )
  })

  it('lands an OAuth error on the account step, even when guest is remembered', () => {
    expect(
      resolveAuthMethod({ param: undefined, remembered: 'guest', error: 'oauth_failed' }),
    ).toBe('account')
  })

  it('ignores an unknown step in the URL, falling back to the remembered choice', () => {
    expect(resolveAuthMethod({ param: 'admin', remembered: 'guest', error: undefined })).toBe(
      'guest',
    )
  })

  it('ignores an unknown remembered value, showing the choice', () => {
    expect(resolveAuthMethod({ param: undefined, remembered: 'evil', error: undefined })).toBe(null)
  })
})

describe('parseAuthMethod', () => {
  it.each([
    ['account', 'account'],
    ['guest', 'guest'],
    ['', null],
    [undefined, null],
    ['ACCOUNT', null],
  ])('%s → %s', (value, expected) => {
    expect(parseAuthMethod(value)).toBe(expected)
  })
})
