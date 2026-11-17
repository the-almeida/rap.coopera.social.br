import { describe, expect, it } from 'vitest'

import { continueAsGuestSchema } from './continue-as-guest.schema'

const PASSWORD = 'correct-horse-1'

describe('continueAsGuestSchema', () => {
  it('trims and lowercases the nickname before checking it', () => {
    expect(continueAsGuestSchema.parse({ nickname: '  Wolf_42 ', password: PASSWORD })).toEqual({
      nickname: 'wolf_42',
      password: PASSWORD,
    })
  })

  it.each(['wo', 'a'.repeat(31), 'wolf.42', 'wolf@x', 'wolf+1', 'wölf', 'wolf 42'])(
    'rejects the nickname %o',
    (nickname) => {
      const parsed = continueAsGuestSchema.safeParse({ nickname, password: PASSWORD })

      expect(parsed.success).toBe(false)
      expect(parsed.error?.issues.map((issue) => issue.path[0])).toEqual(['nickname'])
    },
  )

  it('asks for the same password length as an email account: 8 to 72 characters', () => {
    const passwordIssues = (password: string) =>
      continueAsGuestSchema
        .safeParse({ nickname: 'wolf', password })
        .error?.issues.map((issue) => issue.path[0]) ?? []

    expect(passwordIssues('a'.repeat(7))).toEqual(['password'])
    expect(passwordIssues('a'.repeat(8))).toEqual([])
    expect(passwordIssues('a'.repeat(72))).toEqual([])
    expect(passwordIssues('a'.repeat(73))).toEqual(['password'])
  })
})
