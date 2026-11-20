import { describe, expect, it } from 'vitest'

import { isForeignKeyViolation, isUniqueViolation } from './errors'

describe('postgres error helpers', () => {
  const unique = { code: '23505', constraint_name: 'leagues_slug_unique' }

  it('detects a direct unique violation', () => {
    expect(isUniqueViolation(unique)).toBe(true)
  })

  it('detects a violation wrapped in cause', () => {
    expect(isUniqueViolation(new Error('wrapped', { cause: unique }))).toBe(true)
  })

  it('filters by constraint name when given', () => {
    expect(isUniqueViolation(unique, 'leagues_slug_unique')).toBe(true)
    expect(isUniqueViolation(unique, 'other_constraint')).toBe(false)
  })

  it('does not confuse error codes', () => {
    expect(isForeignKeyViolation(unique)).toBe(false)
    expect(isForeignKeyViolation({ code: '23503' })).toBe(true)
  })

  it('ignores non-objects', () => {
    expect(isUniqueViolation(null)).toBe(false)
    expect(isUniqueViolation('23505')).toBe(false)
  })
})
