import { describe, expect, it } from 'vitest'

import {
  McProfileIdSchema,
  VulgoClaimIdSchema,
  VulgoIdSchema,
  type McProfileId,
} from '@/shared/lib/ids'

import { ensureClaimable, ensureDecidable, type Vulgo, type VulgoClaim } from './mc'

const me = McProfileIdSchema.parse('00000000-0000-4000-8000-000000000001')
const other = McProfileIdSchema.parse('00000000-0000-4000-8000-000000000002')

const vulgo = (mcProfileId: McProfileId | null): Vulgo => ({
  id: VulgoIdSchema.parse('00000000-0000-4000-8000-0000000000aa'),
  name: 'Neguinho',
  slug: 'neguinho',
  mcProfileId,
  createdAt: new Date(),
})

const claim = (status: VulgoClaim['status']): VulgoClaim => ({
  id: VulgoClaimIdSchema.parse('00000000-0000-4000-8000-0000000000cc'),
  vulgoId: vulgo(null).id,
  mcProfileId: me,
  status,
  decidedBy: null,
  decidedAt: null,
  createdAt: new Date(),
})

describe('ensureClaimable', () => {
  it('accepts unclaimed vulgos', () => {
    expect(ensureClaimable(vulgo(null), me).ok).toBe(true)
  })

  it('rejects vulgos that already have an owner', () => {
    expect(ensureClaimable(vulgo(me), me).ok).toBe(false)
    expect(ensureClaimable(vulgo(other), me).ok).toBe(false)
  })
})

describe('ensureDecidable', () => {
  it('decides pending claims once', () => {
    expect(ensureDecidable(claim('pending'), vulgo(null), 'approved').ok).toBe(true)
    expect(ensureDecidable(claim('approved'), vulgo(null), 'rejected').ok).toBe(false)
    expect(ensureDecidable(claim('rejected'), vulgo(null), 'approved').ok).toBe(false)
  })

  it('cannot approve a vulgo someone else got meanwhile, but can still reject', () => {
    expect(ensureDecidable(claim('pending'), vulgo(other), 'approved').ok).toBe(false)
    expect(ensureDecidable(claim('pending'), vulgo(other), 'rejected').ok).toBe(true)
  })
})
