import { describe, expect, it } from 'vitest'

import { slugSchema } from '@/shared/lib/validation'

import { nextAvailableSlug, resolveUniqueSlug, SLUG_MAX_LENGTH, slugify } from '.'

describe('slugify', () => {
  it('lowercases and hyphenates words', () => {
    expect(slugify('Batalha da Esquina Fictícia')).toBe('batalha-da-esquina-ficticia')
  })

  it('strips diacritics instead of dropping letters', () => {
    expect(slugify('João Ação Pé')).toBe('joao-acao-pe')
  })

  it('collapses punctuation and trims separators', () => {
    expect(slugify('  MC  Xablau!! (SP)  ')).toBe('mc-xablau-sp')
  })

  it('returns an empty string when nothing sluggable remains', () => {
    expect(slugify('🔥🎤')).toBe('')
  })

  it('caps the length without leaving a trailing hyphen', () => {
    const slug = slugify(`${'a'.repeat(SLUG_MAX_LENGTH - 1)} b`)
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH)
    expect(slugSchema.safeParse(slug).success).toBe(true)
  })
})

describe('nextAvailableSlug', () => {
  it('returns the base when free', () => {
    expect(nextAvailableSlug('esquina', ['esquina-2'])).toBe('esquina')
  })

  it('appends the first free numeric suffix', () => {
    expect(nextAvailableSlug('esquina', ['esquina', 'esquina-2'])).toBe('esquina-3')
  })

  it('keeps suffixed slugs within the max length', () => {
    const base = 'a'.repeat(SLUG_MAX_LENGTH)
    const slug = nextAvailableSlug(base, [base])
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH)
    expect(slug.endsWith('-2')).toBe(true)
  })
})

describe('resolveUniqueSlug', () => {
  const existing = ['esquina', 'esquina-2']
  const findSlugsLike = async (base: string) =>
    existing.filter((slug) => slug === base || slug.startsWith(`${base}-`))

  it('derives a free slug from the name', async () => {
    const result = await resolveUniqueSlug({
      requested: undefined,
      name: 'Esquina',
      fallback: 'league',
      findSlugsLike,
    })
    expect(result).toEqual({ ok: true, value: 'esquina-3' })
  })

  it('uses the fallback when the name has nothing sluggable', async () => {
    const result = await resolveUniqueSlug({
      requested: undefined,
      name: '🔥',
      fallback: 'mc',
      findSlugsLike,
    })
    expect(result).toEqual({ ok: true, value: 'mc' })
  })

  it('keeps a free requested slug verbatim', async () => {
    const result = await resolveUniqueSlug({
      requested: 'esquina-sp',
      name: 'Esquina',
      fallback: 'league',
      findSlugsLike,
    })
    expect(result).toEqual({ ok: true, value: 'esquina-sp' })
  })

  it('rejects a taken requested slug instead of silently renaming it', async () => {
    const result = await resolveUniqueSlug({
      requested: 'esquina',
      name: 'Esquina',
      fallback: 'league',
      findSlugsLike,
    })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error.code).toBe('CONFLICT')
  })
})
