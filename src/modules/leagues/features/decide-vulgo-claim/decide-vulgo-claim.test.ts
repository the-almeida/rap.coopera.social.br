import { describe, expect, it } from 'vitest'

import { decideVulgoClaimSchema } from './decide-vulgo-claim.schema'

const claimId = '00000000-0000-4000-8000-000000000000'

describe('decideVulgoClaimSchema', () => {
  it('accepts approve or reject', () => {
    expect(decideVulgoClaimSchema.safeParse({ claimId, decision: 'approved' }).success).toBe(true)
    expect(decideVulgoClaimSchema.safeParse({ claimId, decision: 'rejected' }).success).toBe(true)
  })

  it('rejects anything else', () => {
    expect(decideVulgoClaimSchema.safeParse({ claimId, decision: 'pending' }).success).toBe(false)
  })
})
