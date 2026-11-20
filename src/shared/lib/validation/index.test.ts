import { describe, expect, it } from 'vitest'

import { dateInputSchema, optionalText, requiredText } from '.'

describe('dateInputSchema', () => {
  it('accepts Date instances', () => {
    const date = new Date('2026-03-01T20:00:00Z')
    expect(dateInputSchema.parse(date)).toEqual(date)
  })

  it('parses ISO strings with an offset', () => {
    expect(dateInputSchema.parse('2026-03-01T20:00:00-03:00')).toEqual(
      new Date('2026-03-01T23:00:00Z'),
    )
  })

  it('rejects ISO strings without an offset', () => {
    expect(dateInputSchema.safeParse('2026-03-01T20:00:00').success).toBe(false)
  })
})

describe('requiredText', () => {
  it('trims and rejects blank values', () => {
    expect(requiredText(10).parse('  hi  ')).toBe('hi')
    expect(requiredText(10).safeParse('   ').success).toBe(false)
  })
})

describe('optionalText', () => {
  const schema = optionalText(10)

  it('keeps undefined as undefined (field not provided)', () => {
    expect(schema.parse(undefined)).toBeUndefined()
  })

  it('turns null and blank strings into null (clear the field)', () => {
    expect(schema.parse(null)).toBeNull()
    expect(schema.parse('   ')).toBeNull()
  })

  it('trims real values', () => {
    expect(schema.parse(' Rua A ')).toBe('Rua A')
  })
})
