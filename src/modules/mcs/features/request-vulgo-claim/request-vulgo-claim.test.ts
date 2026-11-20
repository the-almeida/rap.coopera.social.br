import { describe, expect, it } from 'vitest'

import { requestVulgoClaimSchema } from './request-vulgo-claim.schema'

describe('requestVulgoClaimSchema', () => {
  it('requires a vulgo id', () => {
    expect(requestVulgoClaimSchema.safeParse({}).success).toBe(false)
    expect(
      requestVulgoClaimSchema.safeParse({ vulgoId: '00000000-0000-4000-8000-000000000000' })
        .success,
    ).toBe(true)
  })
})
